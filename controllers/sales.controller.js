const SaleOrder = require("../models/SaleOrders");
const SaleOrderDetail = require("../models/SaleOrderDetails");
const Client = require("../models/Client.model");
const User = require("../models/User.model");
const mongoose = require("mongoose");

const esc = (s = "") => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalize = (v) => String(v || "").trim();

/** Resolve Client: name OR externalId -> externalId (canonical) */
async function resolveClientExternalId(input) {
  const token = normalize(input);
  if (!token) return null;

  // if it already looks like an externalId and exists, return as-is
  let found = await Client.findOne({ externalId: token }, { _id: 0, externalId: 1 }).lean();
  if (found?.externalId) return found.externalId;

  // else try exact name (case-insensitive)
  found = await Client.findOne(
    { name: { $regex: new RegExp(`^${esc(token)}$`, "i") } },
    { _id: 0, externalId: 1 }
  ).lean();

  return found?.externalId || null;
}

/** Resolve User: name OR email -> email (canonical) */
async function resolveUserEmail(input) {
  const token = normalize(input);
  if (!token) return null;

  // if already an email and exists, return as-is
  let found = await User.findOne(
    { email: token.toLowerCase() },
    { _id: 0, email: 1 }
  ).lean();
  if (found?.email) return found.email.toLowerCase();

  // else try exact name (case-insensitive)
  found = await User.findOne(
    { name: { $regex: new RegExp(`^${esc(token)}$`, "i") } },
    { _id: 0, email: 1 }
  ).lean();

  return found?.email?.toLowerCase() || null;
}

function midnightRangeForPreset(preset) {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const start = new Date(now);
  const end = new Date(now);

  switch ((preset || "").toLowerCase()) {
    case "today":
      start.setUTCHours(0, 0, 0, 0);
      end.setUTCDate(d + 1); end.setUTCHours(0, 0, 0, 0);
      return { start, end };
    case "this_month":
      start.setUTCFullYear(y, m, 1); start.setUTCHours(0, 0, 0, 0);
      end.setUTCFullYear(y, m + 1, 1); end.setUTCHours(0, 0, 0, 0);
      return { start, end };
    case "this_year":
      start.setUTCFullYear(y, 0, 1); start.setUTCHours(0, 0, 0, 0);
      end.setUTCFullYear(y + 1, 0, 1); end.setUTCHours(0, 0, 0, 0);
      return { start, end };
    case "prev_year":
      start.setUTCFullYear(y - 1, 0, 1); start.setUTCHours(0, 0, 0, 0);
      end.setUTCFullYear(y, 0, 1); end.setUTCHours(0, 0, 0, 0);
      return { start, end };
    default:
      return null;
  }
}

/* --------------------------------------- GET ---------------------------------- */
const getSaleOrdersLists = async (req, res) => {
  try {
    // ---- pagination ----
    const PAGE_SIZE = 100;
    const pageRaw = parseInt(req.query.page, 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const skip = (page - 1) * PAGE_SIZE;

    // ---- params ----
    const q = String(req.query.q || "").trim();
    const statusesRaw = String(req.query.statuses || "").trim(); // "pending,shipped"
    const datePreset = (req.query.datePreset || "").trim().toLowerCase();
    const fromRaw = req.query.from ? new Date(req.query.from) : null;
    const toRaw   = req.query.to ? new Date(req.query.to) : null;

    // ---- base where ----
    const where = {};
    const and = [];

    // STATUS (case-insensitive exact)
    if (statusesRaw) {
      const arr = statusesRaw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (arr.length) {
        const rxList = arr.map((s) => new RegExp(`^${esc(s)}$`, "i"));
        and.push({ OrderStatus: { $in: rxList } });
      }
    }

    // DATE (prefer TimeStampDate, fallback to parsing TimeStamp)
    let range = null;
    if (fromRaw && !isNaN(fromRaw)) {
      const start = new Date(fromRaw); start.setUTCHours(0, 0, 0, 0);
      const end = toRaw && !isNaN(toRaw) ? new Date(toRaw) : new Date(fromRaw);
      end.setUTCDate(end.getUTCDate() + 1); end.setUTCHours(0, 0, 0, 0);
      range = { start, end };
    } else if (datePreset) {
      range = midnightRangeForPreset(datePreset);
    }

    if (range) {
      // If you already added TimeStampDate: use it (fast).
      and.push({
        $or: [
          { TimeStampDate: { $gte: range.start, $lt: range.end } },
          // Fallback: parse the string TimeStamp with $expr
          {
            $expr: {
              $and: [
                {
                  $gte: [
                    {
                      $ifNull: [
                        {
                          $dateFromString: {
                            dateString: "$TimeStamp",
                            format: "%m/%d/%Y %H:%M:%S",
                            onError: { $toDate: "$TimeStamp" },
                            onNull: null,
                          },
                        },
                        null,
                      ],
                    },
                    range.start,
                  ],
                },
                {
                  $lt: [
                    {
                      $ifNull: [
                        {
                          $dateFromString: {
                            dateString: "$TimeStamp",
                            format: "%m/%d/%Y %H:%M:%S",
                            onError: { $toDate: "$TimeStamp" },
                            onNull: null,
                          },
                        },
                        null,
                      ],
                    },
                    range.end,
                  ],
                },
              ],
            },
          },
        ],
      });
    }

    // SEARCH across:
    // - OrderID/City/State/OrderStatus
    // - Client.name (map to externalId -> ClientID IN [...]) OR direct externalId
    // - User.name (map to email -> SalesRep IN [...]) OR direct email
    if (q) {
      const rx = new RegExp(esc(q), "i");

      // 1) direct order fields
      const orDirect = [
        { OrderID: rx },
        { City: rx },
        { State: rx },
        { OrderStatus: rx },
      ];

      // 2) match Client by name OR externalId string
      const matchedClients = await Client.find(
        { $or: [{ name: rx }, { externalId: rx }] },
        { _id: 0, externalId: 1 }
      ).lean();
      const clientIds = [
        ...new Set(matchedClients.map((c) => (c.externalId || "").trim()).filter(Boolean)),
      ];
      if (clientIds.length) {
        orDirect.push({ ClientID: { $in: clientIds } });
      }

      // 3) match User by name OR email
      const matchedUsers = await User.find(
        { $or: [{ name: rx }, { email: rx }] },
        { _id: 0, email: 1 }
      ).lean();
      const repEmails = [
        ...new Set(matchedUsers.map((u) => (u.email || "").toLowerCase().trim()).filter(Boolean)),
      ];
      if (repEmails.length) {
        orDirect.push({ SalesRep: { $in: repEmails } });
      }

      and.push({ $or: orDirect });
    }

    if (and.length) where.$and = and;

    // ---- projection ----
    const projection = {
      _id: 1,
      Label: 1,
      OrderID: 1,
      ClientID: 1,
      SalesRep: 1,
      TimeStamp: 1,
      City: 1,
      State: 1,
      LockPrices: 1,
      OrderStatus: 1,
      TimeStampDate: 1,
      createdAt: 1,
      Discount: 1,
      Tax: 1,
      Total: 1,
      GrandTotal: 1,
    };

    // ---- query ----
    const [totalDocs, saleOrdersPage] = await Promise.all([
      SaleOrder.countDocuments(where),
      SaleOrder.find(where, projection)
        .sort({ TimeStampDate: -1, createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(PAGE_SIZE)
        .lean(),
    ]);

    // ---- page-scoped name resolution ----
    const clientKeys = [
      ...new Set(saleOrdersPage.map((o) => (o.ClientID || "").trim()).filter(Boolean)),
    ];
    const repKeys = [
      ...new Set(saleOrdersPage.map((o) => (o.SalesRep || "").toLowerCase().trim()).filter(Boolean)),
    ];

    const [clients, users] = await Promise.all([
      clientKeys.length
        ? Client.find({ externalId: { $in: clientKeys } }, { _id: 0, externalId: 1, name: 1 }).lean()
        : [],
      repKeys.length
        ? User.find({ email: { $in: repKeys } }, { _id: 0, email: 1, name: 1 }).lean()
        : [],
    ]);

    const nameByExternalId = new Map(clients.map((c) => [c.externalId, c.name]));
    const nameByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.name]));

    const data = saleOrdersPage.map((o) => ({
      _id: o._id,
      Label: o.Label,
      OrderID: o.OrderID,
      ClientID: nameByExternalId.get((o.ClientID || "").trim()) || o.ClientID || null,
      SalesRep: nameByEmail.get((o.SalesRep || "").toLowerCase().trim()) || o.SalesRep || null,
      TimeStamp: o.TimeStamp || null,
      City: o.City || null,
      State: o.State || null,
      LockPrices: o.LockPrices ?? null,
      OrderStatus: o.OrderStatus || null,
      Discount: o.Discount || 0,
      Tax: o.Tax || 0,
      Total: o.PaymentAmount || 0,
      GrandTotal: o.PaymentAmount || 0,
    }));

    const totalPages = Math.ceil(totalDocs / PAGE_SIZE);

    return res.status(200).json({
      success: true,
      message: "Sale orders retrieved successfully",
      pagination: {
        page,
        limit: PAGE_SIZE,
        totalDocs,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      data,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getSaleOrdersListById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid order id" });
    }

    // 1) Find the base order
    const order = await SaleOrder.findById(id).lean();
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Sale order not found", data: null });
    }

    // 2) Fetch order items + lookups (client name, sales rep name) in parallel
    const [items, clientDoc, userDoc] = await Promise.all([
      // All lines where foreign OrderID matches the order's OrderID (string)
      SaleOrderDetail.find({ OrderID: order.OrderID }).lean(),

      // Map external id -> client name
      order.ClientID
        ? Client.findOne(
            { externalId: order.ClientID },
            { _id: 0, name: 1, externalId: 1 }
          ).lean()
        : null,

      // Map email -> user name
      order.SalesRep
        ? User.findOne(
            { email: (order.SalesRep || "").toLowerCase().trim() },
            { _id: 0, name: 1, email: 1 }
          ).lean()
        : null,
    ]);

    // 3) Build merged payload
    const merged = {
      // keep Mongo id
      _id: order._id,

      // show human-friendly fields while preserving originals in `originals`
      OrderID: order.OrderID,
      Label: order.Label,
      Client: clientDoc?.name || order.ClientID || "",     // <-- resolved
      SalesRep: userDoc?.name || order.SalesRep || "",     // <-- resolved

      // keep the rest of the order fields as-is
      TimeStamp: order.TimeStamp,
      Discount: order.Discount,
      PaymentMethod: order.PaymentMethod,
      ShippedDate: order.ShippedDate,
      ShippingMethod: order.ShippingMethod,
      Tracking: order.Tracking,
      ShippingCost: order.ShippingCost,
      Tax: order.Tax,
      Paid: order.Paid,
      ShiptoAddress: order.ShiptoAddress,
      City: order.City,
      State: order.State,
      PaymentDate: order.PaymentDate,
      PaymentAmount: order.PaymentAmount,
      LockPrices: order.LockPrices,
      OrderStatus: order.OrderStatus,

      // full details/items
      items: items || [],
      itemsCount: (items || []).length,

      // (optional) preserve raw identifiers in case you ever need them
      originals: {
        ClientID: order.ClientID,
        SalesRepEmail: order.SalesRep,
      },
    };

    return res.status(200).json({
      success: true,
      message: "Sale order details retrieved successfully",
      data: merged,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

async function getLatestOrderPerClient(req, res) {
  const PAGE_SIZE = 100;
  const pageNum = parseInt(req.query.page, 10);
  const p = Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1;

  const tsAsDate = {
    $ifNull: [
      {
        $dateFromString: {
          dateString: "$TimeStamp",
          format: "%m/%d/%Y %H:%M:%S",
          onError: { $toDate: "$TimeStamp" },
        },
      },
      { $toDate: "$TimeStamp" },
    ],
  };

  const pipeline = [
    // 0) Normalize ClientID -> _clientId (handles null/missing/whitespace)
    {
      $addFields: {
        _clientId: { $trim: { input: { $ifNull: ["$ClientID", ""] } } },
      },
    },

    // 1) Strictly require non-empty client id
    { $match: { $expr: { $gt: [{ $strLenCP: "$_clientId" }, 0] } } },

    // 2) Parse timestamp
    { $addFields: { _parsedTime: tsAsDate } },

    // 3) Sort so first per client is newest
    { $sort: { _clientId: 1, _parsedTime: -1 } },

    // 4) Keep latest per client
    { $group: { _id: "$_clientId", latest: { $first: "$$ROOT" } } },
    { $replaceRoot: { newRoot: "$latest" } },

    // 5) Join client by externalId — and DROP if no match
    {
      $lookup: {
        from: Client.collection.name,
        let: { extId: "$_clientId" },
        pipeline: [
          { $match: { $expr: { $eq: ["$externalId", "$$extId"] } } },
          { $project: { _id: 0, name: 1 } },
        ],
        as: "clientDoc",
      },
    },
    // Don't preserve nulls: rows with no real client are removed
    { $unwind: "$clientDoc" },

    // 6) Join user by SalesRep email (ok to be missing; name will be undefined)
    {
      $lookup: {
        from: User.collection.name,
        localField: "SalesRep",
        foreignField: "email",
        as: "userDoc",
      },
    },
    { $unwind: { path: "$userDoc", preserveNullAndEmptyArrays: true } },

    // 7) Final sort newest-first across clients
    { $sort: { _parsedTime: -1 } },

    // 8) Only requested fields
    {
      $project: {
        _id: 0,
        clientName: "$clientDoc.name",
        salesRepName: "$userDoc.name",
        timeStamp: "$TimeStamp",
      },
    },

    // 9) Pagination
    { $skip: (p - 1) * PAGE_SIZE },
    { $limit: PAGE_SIZE },
  ];

  const data = await SaleOrder.aggregate(pipeline);

  // Count unique valid clients (non-empty client id + must exist in Clients)
  const countAgg = await SaleOrder.aggregate([
    {
      $addFields: {
        _clientId: { $trim: { input: { $ifNull: ["$ClientID", ""] } } },
      },
    },
    { $match: { $expr: { $gt: [{ $strLenCP: "$_clientId" }, 0] } } },
    {
      $lookup: {
        from: Client.collection.name,
        let: { extId: "$_clientId" },
        pipeline: [
          { $match: { $expr: { $eq: ["$externalId", "$$extId"] } } },
          { $project: { _id: 0 } },
        ],
        as: "clientDoc",
      },
    },
    { $unwind: "$clientDoc" },
    { $group: { _id: "$_clientId" } },
    { $count: "count" },
  ]);
  const totalDocs = countAgg[0]?.count ?? 0;

  return res.status(200).json({
    success: true,
    page: p,
    pageSize: PAGE_SIZE,
    totalDocs,
    totalPages: Math.ceil(totalDocs / PAGE_SIZE),
    data,
  });
}

/* --------------------------------------- CREATE ---------------------------------- */
const createSaleOrder = async (req, res) => {
  try {
    const body = req.body || {};

    // Resolve identifiers from flexible inputs
    const resolvedClientId = await resolveClientExternalId(body.ClientID);
    const resolvedSalesRep  = await resolveUserEmail(body.SalesRep);

    if (!resolvedClientId)
      return res.status(400).json({ success: false, message: "Client not found (by name or externalId)" });

    if (!resolvedSalesRep)
      return res.status(400).json({ success: false, message: "Sales rep not found (by name or email)" });

    // Required fields after resolution
    const required = [
      resolvedClientId,
      resolvedSalesRep,
      body.City,
      body.State,
      body.LockPrices,
      body.OrderStatus,
    ];
    if (required.some((x) => !normalize(x)))
      return res.status(400).json({ success: false, message: "Missing required fields" });

    console.log(body);

    const saleOrder = await SaleOrder.create({
      ClientID: resolvedClientId,     // canonical externalId
      SalesRep: resolvedSalesRep,     // canonical email
      Discount: body.Discount,
      PaymentMethod: body.PaymentMethod,
      ShippedDate: body.ShippedDate,
      ShippingMethod: body.ShippingMethod,
      ShippingCost: body.ShippingCost,
      Tax: body.Tax,
      Paid: body.Paid,
      ShiptoAddress: body.ShiptoAddress,
      City: body.City,
      State: body.State,
      PaymentDate: body.PaymentDate,
      PaymentAmount: body.PaymentAmount,
      LockPrices: body.LockPrices,
      OrderStatus: body.OrderStatus,
      OrderID: "15768",          // keep if you send it
      TimeStamp: Date?.now(),      // keep if you send it
      Label: "15768"
    });

    return res.status(200).json({
      success: true,
      message: "Sale order created successfully",
      data: saleOrder,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* --------------------------------------- UPDATE ---------------------------------- */
const updateSaleOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    console.log(body);


    const update = { ...body };

    // If caller sent ClientID (name or externalId), resolve to externalId
    if (body.ClientID !== undefined) {
      const resolvedClientId = await resolveClientExternalId(body.ClientID);
      if (!resolvedClientId)
        return res.status(400).json({ success: false, message: "Client not found (by name or externalId)" });
      update.ClientID = resolvedClientId;
    }

    // If caller sent SalesRep (name or email), resolve to email
    if (body.SalesRep !== undefined) {
      const resolvedSalesRep = await resolveUserEmail(body.SalesRep);
      if (!resolvedSalesRep)
        return res.status(400).json({ success: false, message: "Sales rep not found (by name or email)" });
      update.SalesRep = resolvedSalesRep;
    }

    const saleOrder = await SaleOrder.findByIdAndUpdate(
      { _id: id },
      update,
      { new: true }
    );

    return res.status(200).json({
      success: true,
      message: "Sale order updated successfully",
      data: saleOrder,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* --------------------------------------- DELETE ---------------------------------- */
const deleteSaleOrder = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id)
      return res
        .status(404)
        .json({ success: false, message: "ID is required" });

    const saleOrder = await SaleOrder.findByIdAndDelete({ _id: id });

    return res.status(200).json({
      success: true,
      message: "Sale order deleted successfully",
      data: saleOrder,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getSaleOrdersLists,
  getSaleOrdersListById,
  getLatestOrderPerClient,
  createSaleOrder,
  updateSaleOrder,
  deleteSaleOrder,
};
