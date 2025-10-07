// controllers/clients.controller.js
const Client = require("../models/Client.model");
const User = require("../models/User.model")

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
  'ALABAMA': 'AL','ALASKA': 'AK','ARIZONA': 'AZ','ARKANSAS': 'AR',
  'CALIFORNIA': 'CA','COLORADO': 'CO','CONNECTICUT': 'CT','DELAWARE': 'DE',
  'FLORIDA': 'FL','GEORGIA': 'GA','HAWAII': 'HI','IDAHO': 'ID',
  'ILLINOIS': 'IL','INDIANA': 'IN','IOWA': 'IA','KANSAS': 'KS',
  'KENTUCKY': 'KY','LOUISIANA': 'LA','MAINE': 'ME','MARYLAND': 'MD',
  'MASSACHUSETTS': 'MA','MICHIGAN': 'MI','MINNESOTA': 'MN','MISSISSIPPI': 'MS',
  'MISSOURI': 'MO','MONTANA': 'MT','NEBRASKA': 'NE','NEVADA': 'NV',
  'NEW HAMPSHIRE': 'NH','NEW JERSEY': 'NJ','NEW MEXICO': 'NM','NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC','NORTH DAKOTA': 'ND','OHIO': 'OH','OKLAHOMA': 'OK',
  'OREGON': 'OR','PENNSYLVANIA': 'PA','RHODE ISLAND': 'RI','SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD','TENNESSEE': 'TN','TEXAS': 'TX','UTAH': 'UT',
  'VERMONT': 'VT','VIRGINIA': 'VA','WASHINGTON': 'WA','WEST VIRGINIA': 'WV',
  'WISCONSIN': 'WI','WYOMING': 'WY'
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
          _statusTrim: { $trim: { input: { $ifNull: ["$contactStatus", ""] } } },
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
                        { case: { $eq: ["$$lower", "sampling"] }, then: "Sampling" },
                        { case: { $eq: ["$$lower", "new prospect"] }, then: "New Prospect" },
                        { case: { $eq: ["$$lower", "uncategorized"] }, then: "Uncategorized" },
                        { case: { $eq: ["$$lower", "closed lost"] }, then: "Closed lost" },
                        { case: { $eq: ["$$lower", "initial contact"] }, then: "Initial Contact" },
                        { case: { $eq: ["$$lower", "closed won"] }, then: "Closed won" },
                        { case: { $eq: ["$$lower", "committed"] }, then: "Committed" },
                        { case: { $eq: ["$$lower", "consideration"] }, then: "Consideration" },
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

/* ------------------------------ GET: /lists --------------------------------
   Supports:
   - q: space-separated search across fields (AND of ORs)
   - statuses: CSV (token/word OR exact match; case-insensitive)
   - states:   CSV (exact, trim-tolerant, token match; optional abbrev)
   - page, limit, sortBy, sort
------------------------------------------------------------------------------*/
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
        "name", "email", "phone", "city", "state",
        "website", "ownedBy", "contactStatus",
      ];
      and.push(
        ...regexes.map((r) => ({ $or: searchFields.map((f) => ({ [f]: r })) }))
      );
    }

    // ---- filters ----
    const statusesArr = csvToArray(req.query.statuses);
    const statesArr   = csvToArray(req.query.states);

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
            from: "users",                // << change if your collection name differs
            let: { ownedEmail: "$ownedBy" },
            pipeline: [
              { $match: { $expr: { $eq: ["$email", "$$ownedEmail"] } } },
              { $project: { _id: 0, name: 1, email: 1 } }
            ],
            as: "ownerDoc"
          }
        },

        // Add 'ownerName' (fallback = original email or empty)
        {
          $addFields: {
            ownerName: {
              $ifNull: [{ $first: "$ownerDoc.name" }, "$ownedBy"]
            }
          }
        },

        // optional: hide the joined array; keep ownedBy for back-compat
        { $project: { ownerDoc: 0 } }
        // If you want to completely replace ownedBy with name:
        // { $project: { ownerDoc: 0, ownedBy: 0 } }
      ])
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
      data: clients,                 // now includes ownerName
      meta: { total, page, perPage },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/* ------------------------------- CRUD -------------------------------------- */
const getClientsListById = async (req, res) => {
  try {
    const clientsListById = await Client.findById(req.params.id);
    return res.status(200).json(clientsListById);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

const createClientList = async (req, res) => {
  try {
    const clientsList = await Client.create(req.body);
    return res.status(201).json(clientsList);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

const updateClientList = async (req, res) => {
  try {
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
  getClientsSummary,
  getClientsListById,
  createClientList,
  updateClientList,
  deleteClientList,
};
