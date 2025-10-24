// controllers/activities.js
const mongoose = require("mongoose");
const Activity = require("../models/Activity.model");
const User = require("../models/User.model"); // <- for collection name
const Client = require("../models/Client.model"); // <- for collection name

// --- helpers (as-is) ---
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}
function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}
function endOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}
function startOfYear(year = new Date().getFullYear()) {
  return new Date(year, 0, 1, 0, 0, 0, 0);
}
function endOfYear(year = new Date().getFullYear()) {
  return new Date(year, 11, 31, 23, 59, 59, 999);
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// GET /api/activities/lists?page=1&limit=20&q=&type=call_made,email_sent&dateRange=today|this_month|this_year|prev_year&from=ISO&to=ISO
const getActivitiesLists = async (req, res) => {
  try {
    // pagination
    const pageRaw = parseInt(req.query.page, 10);
    const limitRaw = parseInt(req.query.limit, 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const perReq = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20;
    const perPage = Math.min(perReq, 100);
    const skip = (page - 1) * perPage;

    // sorting
    const sortBy = req.query.sortBy || "createdAt";
    const sortDir = (req.query.sort || "desc").toLowerCase() === "asc" ? 1 : -1;

    // base filters (q + type)
    const baseMatch = {};
    if (req.query.q) {
      const rx = new RegExp(req.query.q, "i");
      baseMatch.$or = [
        { description: rx },
        { trackingId: rx },
        { clientId: rx },
        { userId: rx },
        { type: rx },
      ];
    }
    if (req.query.type) {
      const rawTypes = String(req.query.type)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const inList = [];
      for (const t of rawTypes) {
        const k = t.toLowerCase();
        if (
          k === "call" ||
          k === "call_made" ||
          k === "phone" ||
          k === "phone_call"
        ) {
          inList.push(/^call(_made)?$/i);
          inList.push(/^phone(_call)?$/i);
        } else if (k === "email" || k === "email_sent") {
          inList.push(/^email(_sent)?$/i);
        } else {
          inList.push(new RegExp("^" + escapeRegExp(t) + "$", "i"));
        }
      }
      if (inList.length) baseMatch.type = { $in: inList };
    }

    // date range
    let dateFrom = null,
      dateTo = null;
    const preset = req.query.dateRange;
    if (preset === "today") {
      dateFrom = startOfToday();
      dateTo = endOfToday();
    } else if (preset === "this_month") {
      dateFrom = startOfMonth();
      dateTo = endOfMonth();
    } else if (preset === "this_year") {
      const y = new Date().getFullYear();
      dateFrom = startOfYear(y);
      dateTo = endOfYear(y);
    } else if (preset === "prev_year") {
      const y = new Date().getFullYear() - 1;
      dateFrom = startOfYear(y);
      dateTo = endOfYear(y);
    }
    if (req.query.from) {
      const f = new Date(req.query.from);
      if (!isNaN(f)) dateFrom = f;
    }
    if (req.query.to) {
      const t = new Date(req.query.to);
      if (!isNaN(t)) dateTo = t;
    }
    const hasDateFilter = Boolean(dateFrom || dateTo);

    // collection names from models (avoid hardcoding)
    const usersColl = User.collection.name; // e.g., 'usersdb'
    const clientsColl = Client.collection.name; // whatever you used

    // ---------- total ----------
    let total;
    if (hasDateFilter) {
      const cnt = await Activity.aggregate(
        [
          { $match: baseMatch },
          {
            $addFields: {
              _createdAtDate: {
                $convert: {
                  input: "$createdAt",
                  to: "date",
                  onError: null,
                  onNull: null,
                },
              },
            },
          },
          {
            $match: {
              _createdAtDate: {
                ...(dateFrom ? { $gte: dateFrom } : {}),
                ...(dateTo ? { $lte: dateTo } : {}),
              },
            },
          },
          { $count: "total" },
        ],
        { allowDiskUse: true }
      );
      total = cnt?.[0]?.total || 0;
    } else {
      total = await Activity.countDocuments(baseMatch);
    }

    // ---------- main data ----------
    const pipeline = [
      { $match: baseMatch },

      ...(hasDateFilter
        ? [
            // normalize for date comparison
            {
              $addFields: {
                _createdAtDate: {
                  $convert: {
                    input: "$createdAt",
                    to: "date",
                    onError: null,
                    onNull: null,
                  },
                },
              },
            },
            {
              $match: {
                _createdAtDate: {
                  ...(dateFrom ? { $gte: dateFrom } : {}),
                  ...(dateTo ? { $lte: dateTo } : {}),
                },
              },
            },
            { $sort: { _createdAtDate: sortDir } },
          ]
        : [{ $sort: { [sortBy]: sortDir } }]),

      { $skip: skip },
      { $limit: perPage },

      // prepare clientId to ObjectId for lookup (if it's an ObjectId string)
      {
        $addFields: {
          _clientIdStr: { $toString: { $ifNull: ["$clientId", ""] } },
        },
      },

      // LOOKUPS AFTER PAGINATION (fast)
      // Users: Activity.userId contains EMAIL => join on 'email'
      {
        $lookup: {
          from: usersColl,
          localField: "userId",
          foreignField: "email",
          as: "_u",
        },
      },
      { $unwind: { path: "$_u", preserveNullAndEmptyArrays: true } },

      // Clients: Activity.clientId contains ObjectId (as string) => join on _id
      {
        $lookup: {
          from: clientsColl,
          localField: "_clientIdStr",
          foreignField: "externalId",
          as: "_c",
        },
      },
      { $unwind: { path: "$_c", preserveNullAndEmptyArrays: true } },

      // safe string coercions + name resolution into SAME keys (no extra fields returned)
      {
        $addFields: {
          _userName1: { $toString: { $ifNull: ["$_u.name", ""] } },
          _userFirst: { $toString: { $ifNull: ["$_u.firstName", ""] } },
          _userLast: { $toString: { $ifNull: ["$_u.lastName", ""] } },
          _userEmail: { $toString: { $ifNull: ["$_u.email", ""] } },
        },
      },
      {
        $addFields: {
          _userFull: {
            $trim: { input: { $concat: ["$_userFirst", " ", "$_userLast"] } },
          },
          clientId: { $ifNull: ["$_c.name", "$clientId"] },
        },
      },
      {
        $addFields: {
          userId: {
            $switch: {
              branches: [
                { case: { $ne: ["$_userName1", ""] }, then: "$_userName1" },
                { case: { $ne: ["$_userFull", ""] }, then: "$_userFull" },
                { case: { $ne: ["$_userEmail", ""] }, then: "$_userEmail" },
              ],
              default: "$userId",
            },
          },
        },
      },

      // drop temps
      {
        $project: {
          _clientIdStr: 0,
          _c: 0,
          _u: 0,
          _userName1: 0,
          _userFirst: 0,
          _userLast: 0,
          _userEmail: 0,
          _userFull: 0,
          _createdAtDate: 0,
        },
      },
    ];

    const docs = await Activity.aggregate(pipeline, { allowDiskUse: true });

    return res.status(200).json({
      rows: docs,
      meta: {
        page,
        perPage,
        total,
        totalPages: Math.max(Math.ceil(total / perPage), 1),
        hasPrev: page > 1,
        hasNext: page * perPage < total,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const getActivitiesSummary = async (req, res) => {
  try {
    // ---- optional search (same fields as list) ----
    const match = {};
    if (req.query.q) {
      const rx = new RegExp(req.query.q, "i");
      match.$or = [
        { description: rx },
        { trackingId: rx },
        { clientId: rx },
        { userId: rx },
        { type: rx },
      ];
    }

    // ---- build date range (preset or from/to) ----
    let dateFrom = null,
      dateTo = null;
    const preset = req.query.dateRange;
    if (preset === "today") {
      dateFrom = startOfToday();
      dateTo = endOfToday();
    } else if (preset === "this_month") {
      dateFrom = startOfMonth();
      dateTo = endOfMonth();
    } else if (preset === "this_year") {
      const y = new Date().getFullYear();
      dateFrom = startOfYear(y);
      dateTo = endOfYear(y);
    } else if (preset === "prev_year") {
      const y = new Date().getFullYear() - 1;
      dateFrom = startOfYear(y);
      dateTo = endOfYear(y);
    }
    if (req.query.from) {
      const f = new Date(req.query.from);
      if (!isNaN(f)) dateFrom = f;
    }
    if (req.query.to) {
      const t = new Date(req.query.to);
      if (!isNaN(t)) dateTo = t;
    }
    const hasDate = Boolean(dateFrom || dateTo);

    // ---- aggregation: safe date filter + lowercased type buckets ----
    const pipeline = [
      { $match: match },

      // If date filter present, convert possibly-string createdAt => date and filter
      ...(hasDate
        ? [
            {
              $addFields: {
                _createdAtDate: {
                  $convert: {
                    input: "$createdAt",
                    to: "date",
                    onError: null,
                    onNull: null,
                  },
                },
              },
            },
            {
              $match: {
                _createdAtDate: {
                  ...(dateFrom ? { $gte: dateFrom } : {}),
                  ...(dateTo ? { $lte: dateTo } : {}),
                },
              },
            },
          ]
        : []),

      // Normalize type once
      { $addFields: { _lt: { $toLower: { $ifNull: ["$type", ""] } } } },

      // Group into counts using set membership
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          totalCalls: {
            $sum: {
              $cond: [
                { $in: ["$_lt", ["call", "call_made", "phone", "phone_call"]] },
                1,
                0,
              ],
            },
          },
          totalEmails: {
            $sum: {
              $cond: [{ $in: ["$_lt", ["email", "email_sent"]] }, 1, 0],
            },
          },
        },
      },
      { $project: { _id: 0 } },
    ];

    const [doc] = await Activity.aggregate(pipeline, { allowDiskUse: true });
    return res.status(200).json({
      totalCalls: doc?.totalCalls ?? 0,
      totalEmails: doc?.totalEmails ?? 0,
      total: doc?.total ?? 0,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

const getActivitiesListById = async (req, res) => {
  try {
    const doc = await Activity.findById(req.params.id).lean();
    if (!doc)
      return res.status(404).json({ success: false, message: "Not found" });
    return res.status(200).json({ success: true, data: doc });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const createActivityList = async (req, res) => {
  try {
    const created = await Activity.create(req.body);
    return res.status(201).json({ success: true, data: created });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const updateActivityList = async (req, res) => {
  try {
    console.log(req.body);
    const updated = await Activity.findByIdAndUpdate(
      { _id: req.params.id },
      req.body,
      {
        new: true,
      }
    );
    if (!updated)
      return res.status(404).json({ success: false, message: "Not found" });
    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const deleteActivityList = async (req, res) => {
  try {
    const deleted = await Activity.findByIdAndDelete(req.params.id);
    if (!deleted)
      return res.status(404).json({ success: false, message: "Not found" });
    return res.status(200).json({ success: true, data: deleted });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getActivitiesLists,
  getActivitiesSummary,
  getActivitiesListById,
  createActivityList,
  updateActivityList,
  deleteActivityList,
};
