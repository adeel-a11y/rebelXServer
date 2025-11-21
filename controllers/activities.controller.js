// controllers/activities.js
const mongoose = require("mongoose");
const Activity = require("../models/Activity.model");
const User = require("../models/User.model"); // <- for collection name
const Client = require("../models/Client.model"); // <- for collection name
const crypto = require("crypto");

// buckets (case-insensitive match)
const CALL_TYPES = ["call", "call_made", "phone", "phone_call"];
const EMAIL_TYPES = ["email", "email_sent", "mail"];
const TEXT_TYPES = ["text", "sms", "message", "im"];

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

async function generateExternalId() {
  const MAX_TRIES = 5;

  for (let i = 0; i < MAX_TRIES; i++) {
    // Example format: 7-char alphanumeric, like "6EEZ046"
    const raw = crypto.randomBytes(4).toString("hex").toUpperCase(); // e.g. "A3F7C9D1"
    const candidate = raw.slice(0, 7); // "A3F7C9D"

    const exists = await Client.exists({ externalId: candidate });
    if (!exists) return candidate;
  }

  throw new Error("Could not generate unique externalId");
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

    console.log("req.query.type", req.query.type);
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
        } else if (k === "texts") {
          inList.push(/^text$/i);
        } else {
          inList.push(/^created$/i);
          inList.push(/^status(_changed)$/i);
          inList.push(/^note(_added)$/i);
          inList.push(/^meeting(_scheduled)$/i);
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
    const externalId = String(req.query.externalId || "").trim();

    const pipeline = [];

    // (0) Client filter (agar chahiye)
    if (externalId) {
      pipeline.push({ $match: { clientId: externalId } });
      // NOTE: agar aapke Activity.clientId me "client name" hota hai,
      // to yahan pehle Client find karke { clientId: client.name } match karein.
    }

    // 1) normalize type -> lowercase trimmed
    pipeline.push({
      $addFields: {
        _t: { $toLower: { $trim: { input: { $ifNull: ["$type", ""] } } } },
      },
    });

    // 2) single group with bucketed sums
    pipeline.push({
      $group: {
        _id: null,
        total: { $sum: 1 },
        calls: { $sum: { $cond: [{ $in: ["$_t", CALL_TYPES] }, 1, 0] } },
        emails: { $sum: { $cond: [{ $in: ["$_t", EMAIL_TYPES] }, 1, 0] } },
        texts: { $sum: { $cond: [{ $in: ["$_t", TEXT_TYPES] }, 1, 0] } },
      },
    });

    // 3) compute others = total - (calls+emails+texts)
    pipeline.push({
      $project: {
        _id: 0,
        total: 1,
        calls: 1,
        emails: 1,
        texts: 1,
        others: {
          $max: [
            0,
            {
              $subtract: ["$total", { $add: ["$calls", "$emails", "$texts"] }],
            },
          ],
        },
      },
    });

    const [doc] = await Activity.aggregate(pipeline);
    return res.status(200).json({
      success: true,
      ...{
        total: doc?.total ?? 0,
        calls: doc?.calls ?? 0,
        emails: doc?.emails ?? 0,
        texts: doc?.texts ?? 0,
        others: doc?.others ?? 0,
      },
      message: "Activities summary retrieved successfully",
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getActivitiesListByClientId = async (req, res) => {
  try {
    // 1. pagination (same logic as getActivitiesLists)
    const pageRaw = parseInt(req.query.page, 10);
    const limitRaw = parseInt(req.query.limit, 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const perReq = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20;
    const perPage = Math.min(perReq, 100); // hard cap 100 like main
    const skip = (page - 1) * perPage;

    // 2. sorting (reuse same style)
    const sortBy = req.query.sortBy || "createdAt";
    const sortDir = (req.query.sort || "desc").toLowerCase() === "asc" ? 1 : -1;

    // 3. base filters
    // we ALWAYS filter by clientId (from route param)
    const clientIdParam = req.params.clientId; // this is the client we care about

    const baseMatch = {
      clientId: clientIdParam,
    };

    // Optional search "q" within that client's activities
    if (req.query.q) {
      const rx = new RegExp(req.query.q, "i");
      baseMatch.$or = [
        { description: rx },
        { trackingId: rx },
        { clientId: rx },
        { userId: rx },
        { type: rx },
      ];
      // BUT we still must enforce the clientId match.
      // Easiest way: wrap the whole thing in $and.
      // If we added $or above, restructure:
      baseMatch.$and = [{ clientId: clientIdParam }];
      delete baseMatch.clientId;
    }

    // Optional type[] filter (same normalization rules as main)
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

      // attach to the right level depending on if we used $and/$or above
      if (inList.length) {
        const typeFilter = { type: { $in: inList } };
        if (baseMatch.$and) {
          baseMatch.$and.push(typeFilter);
        } else {
          baseMatch.type = { $in: inList };
        }
      }
    }

    // 4. date range filters (reuse same logic)
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

    // explicit from/to override
    if (req.query.from) {
      const f = new Date(req.query.from);
      if (!isNaN(f)) dateFrom = f;
    }
    if (req.query.to) {
      const t = new Date(req.query.to);
      if (!isNaN(t)) dateTo = t;
    }

    const hasDateFilter = Boolean(dateFrom || dateTo);

    // 5. collection names (just like main fn)
    const usersColl = User.collection.name;
    const clientsColl = Client.collection.name;

    // 6. total count
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

    // 7. main pipeline (copy of getActivitiesLists with baseMatch locked)
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

      // We'll still try to resolve readable client name & user display name
      {
        $addFields: {
          _clientIdStr: {
            $toString: { $ifNull: ["$clientId", ""] },
          },
        },
      },

      // Join user data (Activity.userId is email)
      {
        $lookup: {
          from: usersColl,
          localField: "userId",
          foreignField: "email",
          as: "_u",
        },
      },
      {
        $unwind: {
          path: "$_u",
          preserveNullAndEmptyArrays: true,
        },
      },

      // Join client data (match Activity.clientId -> Client.externalId)
      {
        $lookup: {
          from: clientsColl,
          localField: "_clientIdStr",
          foreignField: "externalId",
          as: "_c",
        },
      },
      {
        $unwind: {
          path: "$_c",
          preserveNullAndEmptyArrays: true,
        },
      },

      // Build final display values
      {
        $addFields: {
          _userName1: {
            $toString: { $ifNull: ["$_u.name", ""] },
          },
          _userFirst: {
            $toString: { $ifNull: ["$_u.firstName", ""] },
          },
          _userLast: {
            $toString: { $ifNull: ["$_u.lastName", ""] },
          },
          _userEmail: {
            $toString: { $ifNull: ["$_u.email", ""] },
          },
        },
      },
      {
        $addFields: {
          _userFull: {
            $trim: {
              input: {
                $concat: ["$_userFirst", " ", "$_userLast"],
              },
            },
          },
          clientId: { $ifNull: ["$_c.name", "$clientId"] },
        },
      },
      {
        $addFields: {
          userId: {
            $switch: {
              branches: [
                {
                  case: { $ne: ["$_userName1", ""] },
                  then: "$_userName1",
                },
                {
                  case: { $ne: ["$_userFull", ""] },
                  then: "$_userFull",
                },
                {
                  case: { $ne: ["$_userEmail", ""] },
                  then: "$_userEmail",
                },
              ],
              default: "$userId",
            },
          },
        },
      },

      // Cleanup temp fields
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

    const docs = await Activity.aggregate(pipeline, {
      allowDiskUse: true,
    });

    // 8. response same shape as getActivitiesLists
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

const getActivitiesListById = async (req, res) => {
  try {
    console.log("id === >", req.params.id);

    // Fetch activity by ID
    const doc = await Activity.findById({ _id: req.params.id }).lean();
    console.log("doc === >", doc);
    if (!doc)
      return res.status(404).json({ success: false, message: "Not found" });

    // Fetch client using $or to check both name and externalId
    const client = await Client.findOne({
      $or: [{ name: doc.clientId }, { externalId: doc.clientId }],
    });
    if (!client)
      return res
        .status(404)
        .json({ success: false, message: "Client not found" });

    doc.clientId = client.name;

    // Fetch user using $or to check both name and email
    const user = await User.findOne({
      $or: [{ name: doc.userId }, { email: doc.userId }],
    });
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    doc.userId = user.name;

    console.log("doc after === >", doc);

    return res.status(200).json({
      success: true,
      message: "Activity retrieved successfully",
      data: doc,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const getActivitiesListByUserPerMonth = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById({ _id: id });
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    const pipelines = [
      { $match: { userId: user?.email } },

      // 1. Convert createdAt to a Date type
      {
        $addFields: {
          convertedCreatedAt: {
            $convert: {
              input: "$createdAt",
              to: "date",
              onError: null,
              onNull: null,
            },
          },
        },
      },

      // 2. Group by numeric Year and Month to calculate activities
      {
        $group: {
          // Grouping ID is now an object containing the numeric year and month
          _id: {
            year: { $year: "$convertedCreatedAt" },
            month: { $month: "$convertedCreatedAt" },
          },
          activities: { $sum: 1 },
          // Capture the full month name string for projection
          monthName: {
            $first: {
              $dateToString: {
                format: "%B", // %B gives the full month name (e.g., "October")
                date: "$convertedCreatedAt",
              },
            },
          },
        },
      },

      // 3. Sort chronologically by Year then numeric Month
      { $sort: { "_id.year": -1, "_id.month": -1 } },

      // 4. Project the final output fields in the requested sequence: month, year, activities
      {
        $project: {
          _id: 0,
          month: "$monthName", // Field 1: Full month name
          year: "$_id.year", // Field 2: Numeric year from the group ID
          activities: "$activities", // Field 3: Activities count
        },
      },
    ];

    console.log("pipelines === ", pipelines);

    const docs = await Activity.aggregate(pipelines);

    return res.status(200).json({ success: true, data: docs?.slice(0, 12) });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const createActivityList = async (req, res) => {
  try {
    const { clientId, userId, type, description, createdAt } = req.body;

    if (!clientId || !userId || !type) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }

    const clientExternalId = await Client.findOne({ name: clientId });
    if (!clientExternalId) {
      return res
        .status(404)
        .json({ success: false, message: "Client not found" });
    }

    const userExternalId = await User.findOne({ name: userId });
    if (!userExternalId) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const trackingId = (await generateExternalId()) || "";

    const created = await Activity.create({
      clientId: clientExternalId.externalId,
      userId: userExternalId.email,
      type,
      trackingId,
      description,
      createdAt,
    });
    return res.status(201).json({ success: true, data: created });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const updateActivityList = async (req, res) => {
  try {
    const { id } = req.params;
    const { clientId, userId, type, description, createdAt } = req.body;

    console.log("id === ", id);
    console.log("clientId === ", clientId);
    console.log("userId === ", userId);
    console.log("type === ", type);
    console.log("description === ", description);
    console.log("createdAt === ", createdAt);

    // Fetch externalId for client
    const clientExternalId = await Client.findOne({ name: clientId });
    if (!clientExternalId) {
      return res
        .status(404)
        .json({ success: false, message: "Client not found" });
    }

    // Fetch externalId for user
    const userExternalId = await User.findOne({ name: userId });
    if (!userExternalId) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Generate or get the trackingId (if it's required to be updated)
    const trackingId = (await generateExternalId()) || "";

    const activity = await Activity.findById({ _id: id });
    if (!activity) {
      return res
        .status(404)
        .json({ success: false, message: "Activity not found" });
    }

    console.log("activity === ", activity);

    // Update the activity
    const updated = await Activity.findByIdAndUpdate(
      { _id: id }, // Find the activity by ID
      {
        clientId: clientExternalId.externalId || activity.clientId, // Set client externalId
        userId: userExternalId.email || activity.userId, // Set user email as userId
        type: type || activity.type, // Set activity type
        trackingId: trackingId || activity.trackingId, // Set trackingId (if required)
        description: description || activity.description, // Set the description
        createdAt: createdAt || activity.createdAt, // Set createdAt date (if applicable)
      },
      {
        new: true, // Return the updated document
      }
    );

    // If the activity wasn't found, return an error
    if (!updated)
      return res
        .status(404)
        .json({ success: false, message: "Activity not found" });

    // Return the updated activity
    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    // Catch and return any server errors
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
  getActivitiesListByClientId,
  getActivitiesListById,
  getActivitiesListByUserPerMonth,
  createActivityList,
  updateActivityList,
  deleteActivityList,
};
