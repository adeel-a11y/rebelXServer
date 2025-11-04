const User = require("../models/User.model");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const escapeReg = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const rxExactI = (s) => new RegExp(`^${escapeReg(s)}$`, "i");

const normRoleToken = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");

/* -------------------------- GET ----------------------- */
const getUsersSummary = async (req, res) => {
  try {
    // (optional) future filters – e.g., ?q=... or ?department=...
    const where = {};
    if (req.query.department) where.department = req.query.department;

    const [result] = await User.aggregate([
      { $match: where },
      // normalize status/role to be safe even if null/typo (defensive)
      {
        $addFields: {
          _status: {
            $cond: [
              {
                $in: [
                  { $toLower: { $ifNull: ["$status", "inactive"] } },
                  ["active", "inactive"],
                ],
              },
              { $toLower: "$status" },
              "inactive",
            ],
          },
          _role: { $toLower: { $ifNull: ["$role", ""] } },
        },
      },

      {
        $facet: {
          // overall totals
          overall: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                active: {
                  $sum: { $cond: [{ $eq: ["$_status", "active"] }, 1, 0] },
                },
                inactive: {
                  $sum: { $cond: [{ $eq: ["$_status", "inactive"] }, 1, 0] },
                },
              },
            },
          ],

          // by status
          byStatus: [
            {
              $group: {
                _id: "$_status",
                count: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ],

          // by role (with active/inactive split)
          byRole: [
            {
              $group: {
                _id: "$_role",
                total: { $sum: 1 },
                active: {
                  $sum: { $cond: [{ $eq: ["$_status", "active"] }, 1, 0] },
                },
                inactive: {
                  $sum: { $cond: [{ $eq: ["$_status", "inactive"] }, 1, 0] },
                },
              },
            },
            // hide empty role rows (if any)
            { $match: { _id: { $ne: "" } } },
            { $sort: { _id: 1 } },
          ],
        },
      },
    ]);

    const overall = result?.overall?.[0] || {
      total: 0,
      active: 0,
      inactive: 0,
    };
    const total = overall.total || 0;

    const byStatus = (result?.byStatus || []).map((s) => ({
      status: s._id === "active" ? "active" : "inactive",
      count: s.count,
      pct: total ? Math.round((s.count / total) * 100) : 0,
    }));

    const byRole = (result?.byRole || []).map((r) => ({
      role: r._id,
      total: r.total,
      active: r.active,
      inactive: r.inactive,
      pctActive: r.total ? Math.round((r.active / r.total) * 100) : 0,
    }));

    return res.status(200).json({
      success: true,
      total,
      active: overall.active || 0,
      inactive: overall.inactive || 0,
      byStatus,
      byRole,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const getUsersLists = async (req, res) => {
  try {
    // --- inputs ---
    const pageRaw = parseInt(req.query.page, 10);
    const limitRaw = parseInt(req.query.limit, 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const perReq = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20;
    const perPage = Math.min(perReq, 20);

    const sortBy = req.query.sortBy || "_id";
    const sortDir = (req.query.sort || "desc").toLowerCase() === "asc" ? 1 : -1;
    const sort = { [sortBy]: sortDir };
    const skip = (page - 1) * perPage;

    // -------- build WHERE as $and clauses --------
    const andClauses = [];

    // q search: AND across words, OR across fields
    const qRaw = (req.query.q || "").trim();
    if (qRaw) {
      const words = qRaw.split(/\s+/).map(escapeReg).filter(Boolean);
      const regexes = words.map((w) => new RegExp(w, "i"));
      const fields = ["name", "email", "phone", "department", "role", "status"];
      regexes.forEach((r) => {
        andClauses.push({ $or: fields.map((f) => ({ [f]: r })) });
      });
    }

    // status filter: ?status=active&status=inactive OR status=active,inactive
    const statusParam = req.query.status;
    if (statusParam) {
      const statuses = (
        Array.isArray(statusParam)
          ? statusParam
          : String(statusParam).split(",")
      )
        .map((s) => String(s).trim())
        .filter(Boolean);
      if (statuses.length) {
        // case-insensitive exact match
        andClauses.push({ status: { $in: statuses.map(rxExactI) } });
      }
    }

    // role filter: ?role=warehouse&role=admin OR role=warehouse,admin
    const roleParam = req.query.role;
    if (roleParam) {
      const roles = (
        Array.isArray(roleParam) ? roleParam : String(roleParam).split(",")
      )
        .map((s) => normRoleToken(s))
        .filter(Boolean);
      if (roles.length) {
        // DB me roles kabhi hyphen/space mixed ho sakte hain, isliye 2 patterns:
        // - exact match on normalized with hyphen (sales-director)
        // - OR exact match on spaced form (sales director)
        const roleRegexes = [];
        roles.forEach((r) => {
          roleRegexes.push(rxExactI(r)); // hyphen form
          roleRegexes.push(rxExactI(r.replace(/-/g, " "))); // spaced form
        });
        andClauses.push({ role: { $in: roleRegexes } });
      }
    }

    const where = andClauses.length ? { $and: andClauses } : {};

    // -------- query --------
    const [total, users] = await Promise.all([
      User.countDocuments(where),
      User.find(where)
        .sort(sort)
        .skip(skip)
        .limit(perPage)
        .select("-password -hash -salt -__v")
        .lean(),
    ]);

    const totalPages = Math.max(Math.ceil(total / perPage), 1);

    return res.status(200).json({
      success: true,
      message: "Users retrieved successfully",
      page,
      perPage,
      total,
      totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
      prevPage: page > 1 ? page - 1 : null,
      nextPage: page < totalPages ? page + 1 : null,
      data: users,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const getUserNames = async (req, res) => {
  try {
    const users = await User.find({});
    const names = users.map((c) => c.name);
    return res
      .status(200)
      .json({ success: true, length: names.length, data: names });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

const getUsersListById = async (req, res) => {
  try {
    const doc = await User.findById(req.params.id)
      // .select("-password -__v")
      .lean();
    if (!doc)
      return res.status(404).json({ success: false, error: "User not found" });
    return res.status(200).json({
      success: true,
      message: "User retrieved successfully",
      data: doc,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/* -------------------------- POST ----------------------- */
const createUserList = async (req, res) => {
  try {
    const usersList = await User.create(req.body);
    return res.status(201).json({
      success: true,
      message: "User created successfully",
      data: usersList,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

/* -------------------------- PUT ----------------------- */
const updateUserList = async (req, res) => {
  try {
    const { id } = req.params;
    const { password, ...rest } = req.body;

    console.log("password", password);
    console.log("rest", rest);

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // 1) Apply non-password fields
    Object.assign(user, rest);

    // 2) If password provided, hash it
    if (password && String(password).trim().length) {
      const salt = await bcrypt.genSalt(12);
      user.password = await bcrypt.hash(password, salt);
    }

    // 3) Save (runs schema validators and any pre/post save hooks)
    await user.save();

    // 4) Create a fresh token (adjust claims as needed)
    const token = jwt.sign(
      {
        sub: user._id.toString(),
        email: user.email,
        role: user.role || "user",
      },
      // process.env.JWT_SECRET,
      "rebelxadeel",
      { expiresIn: "7d" }
    );

    // 5) Remove sensitive fields before sending back
    const safeUser = user.toObject();
    delete safeUser.password;
    delete safeUser.__v;

    console.log("safeUser", safeUser);
    console.log("token", token);

    return res.status(200).json({
      success: true,
      message: "User updated successfully",
      token,
      data: safeUser // password is not included
    });
  } catch (error) {
    console.log("error", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};


/* -------------------------- DELETE ----------------------- */
const deleteUserList = async (req, res) => {
  try {
    const usersList = await User.findByIdAndDelete(req.params.id);
    return res.status(200).json({
      success: true,
      message: "User deleted successfully",
      data: usersList,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getUsersSummary,
  getUserNames,
  getUsersLists,
  getUsersListById,
  createUserList,
  updateUserList,
  deleteUserList,
};
