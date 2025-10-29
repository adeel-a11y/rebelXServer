// controllers/clients.controller.js
const Client = require("../models/Client.model");
const User = require("../models/User.model");
const Activity = require("../models/Activity.model");

/* --------------------------------- helpers -------------------------------- */
const CONTACT_STATUSES = [
  "Sampling",
  "New Prospect",
  "Uncategorized",
  "Closed lost",
  "Initial Contact",
  "Closed won",
  "Committed",
  "Consideration",
];

const escapeReg = (s = "") => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const csvToArray = (v) =>
  String(v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// Optional US state abbreviation map (extend as you need)
const STATE_ABBR = {
  ALABAMA: "AL",
  ALASKA: "AK",
  ARIZONA: "AZ",
  ARKANSAS: "AR",
  CALIFORNIA: "CA",
  COLORADO: "CO",
  CONNECTICUT: "CT",
  DELAWARE: "DE",
  FLORIDA: "FL",
  GEORGIA: "GA",
  HAWAII: "HI",
  IDAHO: "ID",
  ILLINOIS: "IL",
  INDIANA: "IN",
  IOWA: "IA",
  KANSAS: "KS",
  KENTUCKY: "KY",
  LOUISIANA: "LA",
  MAINE: "ME",
  MARYLAND: "MD",
  MASSACHUSETTS: "MA",
  MICHIGAN: "MI",
  MINNESOTA: "MN",
  MISSISSIPPI: "MS",
  MISSOURI: "MO",
  MONTANA: "MT",
  NEBRASKA: "NE",
  NEVADA: "NV",
  "NEW HAMPSHIRE": "NH",
  "NEW JERSEY": "NJ",
  "NEW MEXICO": "NM",
  "NEW YORK": "NY",
  "NORTH CAROLINA": "NC",
  "NORTH DAKOTA": "ND",
  OHIO: "OH",
  OKLAHOMA: "OK",
  OREGON: "OR",
  PENNSYLVANIA: "PA",
  "RHODE ISLAND": "RI",
  "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD",
  TENNESSEE: "TN",
  TEXAS: "TX",
  UTAH: "UT",
  VERMONT: "VT",
  VIRGINIA: "VA",
  WASHINGTON: "WA",
  "WEST VIRGINIA": "WV",
  WISCONSIN: "WI",
  WYOMING: "WY",
};

/* ----------------------------- GET: /lists/summary ------------------------ */
const getClientsSummary = async (req, res) => {
  try {
    const match = {};

    const grouped = await Client.aggregate([
      { $match: match },
      {
        $addFields: {
          _statusRaw: { $ifNull: ["$contactStatus", ""] },
          _statusTrim: {
            $trim: { input: { $ifNull: ["$contactStatus", ""] } },
          },
        },
      },
      {
        $addFields: {
          _statusNorm: {
            $cond: [
              { $eq: ["$_statusTrim", ""] },
              "Uncategorized",
              {
                $let: {
                  vars: { lower: { $toLower: "$_statusTrim" } },
                  in: {
                    $switch: {
                      branches: [
                        {
                          case: { $eq: ["$$lower", "sampling"] },
                          then: "Sampling",
                        },
                        {
                          case: { $eq: ["$$lower", "new prospect"] },
                          then: "New Prospect",
                        },
                        {
                          case: { $eq: ["$$lower", "uncategorized"] },
                          then: "Uncategorized",
                        },
                        {
                          case: { $eq: ["$$lower", "closed lost"] },
                          then: "Closed lost",
                        },
                        {
                          case: { $eq: ["$$lower", "initial contact"] },
                          then: "Initial Contact",
                        },
                        {
                          case: { $eq: ["$$lower", "closed won"] },
                          then: "Closed won",
                        },
                        {
                          case: { $eq: ["$$lower", "committed"] },
                          then: "Committed",
                        },
                        {
                          case: { $eq: ["$$lower", "consideration"] },
                          then: "Consideration",
                        },
                      ],
                      default: "Other",
                    },
                  },
                },
              },
            ],
          },
        },
      },
      { $group: { _id: "$_statusNorm", count: { $sum: 1 } } },
    ]);

    const total = grouped.reduce((a, g) => a + g.count, 0);
    const map = Object.fromEntries(grouped.map((g) => [g._id, g.count]));
    const byStatus = [
      ...CONTACT_STATUSES.map((s) => ({ status: s, count: map[s] || 0 })),
      ...(map.Other ? [{ status: "Other", count: map.Other }] : []),
    ];
    const withPct = byStatus.map((x) => ({
      ...x,
      pct: total ? Math.round((x.count / total) * 100) : 0,
    }));

    return res.status(200).json({
      success: true,
      total,
      byStatus: withPct,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

/* --------------------------------- GET -------------------------------------- */

const getClientsNames = async (req, res) => {
  try {
    const clients = await Client.find({});
    const names = clients.map((c) => c.name);
    return res
      .status(200)
      .json({ success: true, length: names.length, data: names });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

const getClientsLists = async (req, res) => {
  try {
    // paging + sorting
    const pageRaw = parseInt(req.query.page, 10);
    const limitRaw = parseInt(req.query.limit, 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const limitReq = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20;
    const perPage = Math.min(limitReq, 100);

    const sortBy = req.query.sortBy || "createdAt";
    const sortDir = (req.query.sort || "desc").toLowerCase() === "asc" ? 1 : -1;
    const sort = { [sortBy]: sortDir };
    const skip = (page - 1) * perPage;

    // base query
    const where = {};
    const and = [];

    // ---- search (AND over words across fields) ----
    const qRaw = (req.query.q || "").trim();
    if (qRaw) {
      const words = qRaw.split(/\s+/).map(escapeReg).filter(Boolean);
      const regexes = words.map((w) => new RegExp(w, "i"));
      const searchFields = [
        "name",
        "email",
        "phone",
        "city",
        "state",
        "website",
        "ownedBy",
        "contactStatus",
      ];
      and.push(
        ...regexes.map((r) => ({ $or: searchFields.map((f) => ({ [f]: r })) }))
      );
    }

    // ---- filters ----
    const statusesArr = csvToArray(req.query.statuses);
    const statesArr = csvToArray(req.query.states);

    if (statusesArr.length) {
      const statusRegexes = [];
      for (const raw of statusesArr) {
        const s = raw.trim();
        if (!s) continue;
        statusRegexes.push(new RegExp(`^${escapeReg(s)}$`, "i"));
        statusRegexes.push(new RegExp(`\\b${escapeReg(s)}\\b`, "i"));
      }
      and.push({ contactStatus: { $in: statusRegexes } });
    }

    if (statesArr.length) {
      const expanded = new Set();
      for (const raw of statesArr) {
        const s = String(raw || "").trim();
        if (!s) continue;
        expanded.add(s);
        const upper = s.toUpperCase();
        if (STATE_ABBR[upper]) expanded.add(STATE_ABBR[upper]); // e.g., Iowa -> IA
      }
      const stateRegexes = [];
      for (const token of expanded) {
        const esc = escapeReg(token);
        stateRegexes.push(new RegExp(`^\\s*${esc}\\s*$`, "i"));
        stateRegexes.push(new RegExp(`\\b${esc}\\b`, "i"));
      }
      and.push({ state: { $in: stateRegexes } });
    }

    if (and.length) where.$and = and;

    // ---- query DB ----
    const [total, clients] = await Promise.all([
      Client.countDocuments(where),

      Client.aggregate([
        { $match: where },
        { $sort: sort },
        { $skip: skip },
        { $limit: perPage },

        // join users by email (ownedBy holds email string)
        {
          $lookup: {
            from: "users", // << change if your collection name differs
            let: { ownedEmail: "$ownedBy" },
            pipeline: [
              { $match: { $expr: { $eq: ["$email", "$$ownedEmail"] } } },
              { $project: { _id: 0, name: 1, email: 1 } },
            ],
            as: "ownerDoc",
          },
        },

        // Add 'ownerName' (fallback = original email or empty)
        {
          $addFields: {
            ownerName: {
              $ifNull: [{ $first: "$ownerDoc.name" }, "$ownedBy"],
            },
          },
        },

        // optional: hide the joined array; keep ownedBy for back-compat
        { $project: { ownerDoc: 0 } },
        // If you want to completely replace ownedBy with name:
        // { $project: { ownerDoc: 0, ownedBy: 0 } }
      ]),
    ]);

    const totalPages = Math.max(Math.ceil(total / perPage), 1);

    return res.status(200).json({
      success: true,
      message: "Clients retrieved successfully",
      page,
      perPage,
      total,
      totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
      prevPage: page > 1 ? page - 1 : null,
      nextPage: page < totalPages ? page + 1 : null,
      data: clients, // now includes ownerName
      meta: { total, page, perPage },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const getClientsListById = async (req, res) => {
  try {
    const clientsListById = await Client.findById({ _id: req.params.id });
    console.log(clientsListById);
    return res.status(200).json({
      success: true,
      message: "Client retrieved successfully",
      data: clientsListById,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const getActivitiesByClient = async (req, res) => {
  try {
    const { id } = req.params;

    console.log("request", req.query);
    
    const escapeRegex = (s = "") => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // pagination params
    const pageRaw = parseInt(req.query.page, 10);
    const limitRaw = parseInt(req.query.limit, 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const limitReq = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 50;
    const perPage = Math.min(limitReq, 100);
    const skip = (page - 1) * perPage;

    // search param
    const q = (req.query.q || "").trim();
    const rx = q ? new RegExp(escapeRegex(q), "i") : null;

    // 1) find the client
    const client = await Client.findById(id).lean();
    if (!client) {
      return res
        .status(404)
        .json({ success: false, error: "Client not found" });
    }

    // 2) base match
    const match = { clientId: client.externalId };

    // 3) optional search filter across common fields
    const searchMatch = rx
      ? {
          $or: [
            { type: rx },
            { description: rx },
            { trackingId: rx },
            { userId: rx },
          ],
        }
      : {};

    // 4) aggregate: counts + page + lookup
    const [agg] = await Activity.aggregate([
      { $match: { ...match, ...searchMatch } },

      // normalize type for robust counting
      {
        $addFields: {
          _normType: { $toLower: { $ifNull: ["$type", "other"] } },
        },
      },

      // sort newest first (adjust if createdAt is string → convert to date first)
      { $sort: { createdAt: -1, _id: -1 } },

      {
        $facet: {
          total: [{ $count: "count" }],

          countsByType: [
            { $group: { _id: "$_normType", count: { $sum: 1 } } },
            { $project: { _id: 0, type: "$_id", count: 1 } },
          ],

          data: [
            { $skip: skip },
            { $limit: perPage },

            // join users by email (userId stores email)
            {
              $lookup: {
                from: "usersdb",
                let: { email: "$userId" },
                pipeline: [
                  { $match: { $expr: { $eq: ["$email", "$$email"] } } },
                  { $project: { _id: 0, name: 1, email: 1 } },
                ],
                as: "userDoc",
              },
            },
            {
              $addFields: {
                userId: { $ifNull: [{ $first: "$userDoc.name" }, "$userId"] },
              },
            },
            { $project: { userDoc: 0 } },
          ],
        },
      },

      {
        $addFields: {
          total: { $ifNull: [{ $arrayElemAt: ["$total.count", 0] }, 0] },

          emailCount: {
            $let: {
              vars: {
                e: {
                  $first: {
                    $filter: {
                      input: "$countsByType",
                      as: "it",
                      cond: { $eq: ["$$it.type", "email"] },
                    },
                  },
                },
              },
              in: { $ifNull: ["$$e.count", 0] },
            },
          },

          callCount: {
            $let: {
              vars: {
                c: {
                  $first: {
                    $filter: {
                      input: "$countsByType",
                      as: "it",
                      cond: { $eq: ["$$it.type", "call"] },
                    },
                  },
                },
              },
              in: { $ifNull: ["$$c.count", 0] },
            },
          },
        },
      },
    ]);

    const total = agg?.total || 0;
    const data = agg?.data || [];
    const totalPages = Math.max(Math.ceil(total / perPage), 1);
    const emailCount = agg?.emailCount || 0;
    const callCount = agg?.callCount || 0;

    return res.status(200).json({
      success: true,
      message: "Activities retrieved successfully",
      page,
      perPage,
      total,
      totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
      prevPage: page > 1 ? page - 1 : null,
      nextPage: page < totalPages ? page + 1 : null,

      counts: {
        total,
        emails: emailCount,
        calls: callCount,
        others: Math.max(total - emailCount - callCount, 0),
      },

      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve activities",
      error: error.message,
    });
  }
};

/* ------------------------------- CREATE -------------------------------------- */

const createClientList = async (req, res) => {
  try {
    const clientsList = await Client.create(req.body);
    return res.status(201).json({
      data: clientsList,
      message: "Successfully Added New Client",
      success: true,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

/* ------------------------------- UPDATE -------------------------------------- */

const updateClientList = async (req, res) => {
  try {
    const { expirationDateText } = req.body;

    if (expirationDateText) {
      req.body.expirationDateText = new Date(expirationDateText);
    }

    console.log(req.body);

    const clientsList = await Client.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    return res.status(200).json(clientsList);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

const updateClientStatus = async (req, res) => {
  try {
    const { contactStatus } = req.body;
    const clientsList = await Client.findByIdAndUpdate(
      req.params.id,
      { contactStatus },
      { new: true }
    );
    return res.status(200).json({
      data: clientsList,
      success: true,
      message: "Successfuly Update Status",
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

/* ------------------------------- DELETE -------------------------------------- */

const deleteClientList = async (req, res) => {
  try {
    const clientsList = await Client.findByIdAndDelete(req.params.id);
    return res.status(200).json(clientsList);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getClientsLists,
  getClientsNames,
  getClientsSummary,
  getClientsListById,
  getActivitiesByClient,
  createClientList,
  updateClientList,
  updateClientStatus,
  deleteClientList,
};
