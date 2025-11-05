const SaleOrder = require("../models/SaleOrders");
const SaleOrderDetail = require("../models/SaleOrderDetails");
const Client = require("../models/Client.model");
const User = require("../models/User.model");
const mongoose = require("mongoose");
const crypto = require("crypto");
const Counter = require("../models/Counter.model");

const esc = (s = "") => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalize = (v) => String(v || "").trim();

const toNumber = (v) => {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[^\d.-]/g, ""); // strip $ , and spaces
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

const VALID = [
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "SHIPPING",
  "DELIVERED",
  "COMPLETED",
  "ISSUED",
  "PENDING PAYMENT",
  "CANCELLED",
  "RETURNED",
];

const LABELS = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  PROCESSING: "Processing",
  SHIPPING: "Shipping",
  DELIVERED: "Delivered",
  COMPLETED: "Completed",
  ISSUED: "Issued",
  "PENDING PAYMENT": "Pending Payment",
  CANCELLED: "Cancelled",
  RETURNED: "Returned",
};

/** Resolve Client: name OR externalId -> externalId (canonical) */
async function resolveClientExternalId(input) {
  const token = normalize(input);
  if (!token) return null;

  // if it already looks like an externalId and exists, return as-is
  let found = await Client.findOne(
    { externalId: token },
    { _id: 0, externalId: 1 }
  ).lean();
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
      end.setUTCDate(d + 1);
      end.setUTCHours(0, 0, 0, 0);
      return { start, end };
    case "this_month":
      start.setUTCFullYear(y, m, 1);
      start.setUTCHours(0, 0, 0, 0);
      end.setUTCFullYear(y, m + 1, 1);
      end.setUTCHours(0, 0, 0, 0);
      return { start, end };
    case "this_year":
      start.setUTCFullYear(y, 0, 1);
      start.setUTCHours(0, 0, 0, 0);
      end.setUTCFullYear(y + 1, 0, 1);
      end.setUTCHours(0, 0, 0, 0);
      return { start, end };
    case "prev_year":
      start.setUTCFullYear(y - 1, 0, 1);
      start.setUTCHours(0, 0, 0, 0);
      end.setUTCFullYear(y, 0, 1);
      end.setUTCHours(0, 0, 0, 0);
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
    const toRaw = req.query.to ? new Date(req.query.to) : null;

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
      const start = new Date(fromRaw);
      start.setUTCHours(0, 0, 0, 0);
      const end = toRaw && !isNaN(toRaw) ? new Date(toRaw) : new Date(fromRaw);
      end.setUTCDate(end.getUTCDate() + 1);
      end.setUTCHours(0, 0, 0, 0);
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
        ...new Set(
          matchedClients.map((c) => (c.externalId || "").trim()).filter(Boolean)
        ),
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
        ...new Set(
          matchedUsers
            .map((u) => (u.email || "").toLowerCase().trim())
            .filter(Boolean)
        ),
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
      ShippingCost: 1,
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

    const itemsTotal = await SaleOrderDetail.find({
      OrderID: projection.OrderID,
    })
      .select("Total")
      .lean();

    const orderIds = [
      ...new Set(saleOrdersPage.map((o) => o.OrderID).filter(Boolean)),
    ];

    // ---- Load details for these orders in ONE query ----
    let details = [];
    if (orderIds.length) {
      details = await SaleOrderDetail.find(
        { OrderID: { $in: orderIds } },
        { _id: 0, OrderID: 1, Total: 1, Price: 1, QtyShipped: 1 }
      ).lean();
    }

    const subtotalByOrderId = new Map();
    for (const d of details) {
      // Row total: prefer detail.Total; fallback = qty * price
      const rowTotal =
        toNumber(d.Total) || toNumber(d.QtyShipped) * toNumber(d.Price);

      const prev = subtotalByOrderId.get(d.OrderID) || 0;
      subtotalByOrderId.set(d.OrderID, prev + rowTotal);
    }

    // ---- page-scoped name resolution ----
    const clientKeys = [
      ...new Set(
        saleOrdersPage.map((o) => (o.ClientID || "").trim()).filter(Boolean)
      ),
    ];
    const repKeys = [
      ...new Set(
        saleOrdersPage
          .map((o) => (o.SalesRep || "").toLowerCase().trim())
          .filter(Boolean)
      ),
    ];

    const [clients, users] = await Promise.all([
      clientKeys.length
        ? Client.find(
            { externalId: { $in: clientKeys } },
            { _id: 0, externalId: 1, name: 1 }
          ).lean()
        : [],
      repKeys.length
        ? User.find(
            { email: { $in: repKeys } },
            { _id: 0, email: 1, name: 1 }
          ).lean()
        : [],
    ]);

    const nameByExternalId = new Map(
      clients.map((c) => [c.externalId, c.name])
    );
    const nameByEmail = new Map(
      users.map((u) => [u.email.toLowerCase(), u.name])
    );

    const data = saleOrdersPage.map((o) => {
      const itemsSubtotal = subtotalByOrderId.get(o.OrderID) ?? 0;
      const shipping = toNumber(o.ShippingCost);
      const tax = toNumber(o.Tax);
      const discount = toNumber(o.Discount);

      const total = itemsSubtotal; // items ka sum
      const grand = itemsSubtotal + shipping + tax - discount; // requested formula

      return {
        _id: o._id,
        Label: o.Label,
        OrderID: o.OrderID,
        ClientID:
          nameByExternalId.get((o.ClientID || "").trim()) || o.ClientID || null,
        SalesRep:
          nameByEmail.get((o.SalesRep || "").toLowerCase().trim()) ||
          o.SalesRep ||
          null,
        TimeStamp: o.TimeStamp || null,
        City: o.City || null,
        State: o.State || null,
        LockPrices: o.LockPrices ?? null,
        OrderStatus: o.OrderStatus || null,

        Discount: toNumber(o.Discount),
        Tax: toNumber(o.Tax),
        ShippingCost: toNumber(o.ShippingCost),

        // computed values (round if chaho)
        Total: Math.round(total * 100) / 100,
        GrandTotal: Math.round(grand * 100) / 100,
      };
    });

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

async function getSaleOrdersByClient(req, res) {
  try {
    const PAGE_SIZE = 100;
    const pageRaw = parseInt(req.query.page, 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const skip = (page - 1) * PAGE_SIZE;

    // ---- required filter from route param ----
    const externalId = String(req.params.externalId || "").trim();
    if (!externalId) {
      return res.status(400).json({
        success: false,
        message: "externalId (Client externalId) is required",
      });
    }

    // ---- optional params (same as list) ----
    const q = String(req.query.q || "").trim();
    const statusesRaw = String(req.query.statuses || "").trim();
    const datePreset = (req.query.datePreset || "").trim().toLowerCase();
    const fromRaw = req.query.from ? new Date(req.query.from) : null;
    const toRaw = req.query.to ? new Date(req.query.to) : null;

    // ---- base where ----
    const where = { ClientID: externalId }; // <- key constraint
    const and = [];

    // STATUS
    if (statusesRaw) {
      const rxList = statusesRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => new RegExp(`^${esc(s.toLowerCase())}$`, "i"));
      if (rxList.length) and.push({ OrderStatus: { $in: rxList } });
    }

    // DATE
    let range = null;
    if (fromRaw && !isNaN(fromRaw)) {
      const start = new Date(fromRaw);
      start.setUTCHours(0, 0, 0, 0);
      const end = toRaw && !isNaN(toRaw) ? new Date(toRaw) : new Date(fromRaw);
      end.setUTCDate(end.getUTCDate() + 1);
      end.setUTCHours(0, 0, 0, 0);
      range = { start, end };
    } else if (datePreset) {
      range = midnightRangeForPreset(datePreset);
    }
    if (range) {
      and.push({
        $or: [
          { TimeStampDate: { $gte: range.start, $lt: range.end } },
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

    // SEARCH (optional) — still constrained to this client
    if (q) {
      const rx = new RegExp(esc(q), "i");
      and.push({
        $or: [
          { OrderID: rx },
          { City: rx },
          { State: rx },
          { OrderStatus: rx },
          { SalesRep: rx },
          // SalesRep name/email
          // (email direct match; name -> map to emails first if you want, or skip to keep this lighter)
        ],
      });
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
      ShippingCost: 1,
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

    // ---- detail rows for ONLY these orders ----
    const orderIds = [
      ...new Set(saleOrdersPage.map((o) => o.OrderID).filter(Boolean)),
    ];

    let details = [];
    if (orderIds.length) {
      details = await SaleOrderDetail.find(
        { OrderID: { $in: orderIds } },
        { _id: 0, OrderID: 1, Total: 1, Price: 1, QtyShipped: 1 }
      ).lean();
    }

    // ---- sum items per order ----
    const subtotalByOrderId = new Map();
    for (const d of details) {
      const rowTotal =
        toNumber(d.Total) || toNumber(d.QtyShipped) * toNumber(d.Price);
      subtotalByOrderId.set(
        d.OrderID,
        (subtotalByOrderId.get(d.OrderID) || 0) + rowTotal
      );
    }

    // ---- join names (client + rep) ----
    const repKeys = [
      ...new Set(
        saleOrdersPage
          .map((o) => (o.SalesRep || "").toLowerCase().trim())
          .filter(Boolean)
      ),
    ];
    const users = repKeys.length
      ? await User.find(
          { email: { $in: repKeys } },
          { _id: 0, email: 1, name: 1 }
        ).lean()
      : [];
    const nameByEmail = new Map(
      users.map((u) => [u.email.toLowerCase(), u.name])
    );

    // Optional: fetch client name once (we already know externalId)
    const clientDoc = await Client.findOne(
      { externalId: externalId },
      { _id: 0, name: 1, externalId: 1 }
    ).lean();
    const clientName = clientDoc?.name || externalId;

    // ---- shape response with computed totals ----
    const rows = saleOrdersPage.map((o) => {
      const itemsSubtotal = subtotalByOrderId.get(o.OrderID) ?? 0;
      const shipping = toNumber(o.ShippingCost);
      const tax = toNumber(o.Tax);
      const discount = toNumber(o.Discount);

      const total = itemsSubtotal;
      const grand = itemsSubtotal + shipping + tax - discount;

      return {
        _id: o._id,
        Label: o.Label,
        OrderID: o.OrderID,
        Client: clientName, // human name
        SalesRep:
          nameByEmail.get((o.SalesRep || "").toLowerCase().trim()) ||
          o.SalesRep ||
          null,
        TimeStamp: o.TimeStamp || null,
        City: o.City || null,
        State: o.State || null,
        LockPrices: o.LockPrices ?? null,
        OrderStatus: o.OrderStatus || null,
        Discount: toNumber(o.Discount),
        Tax: toNumber(o.Tax),
        ShippingCost: toNumber(o.ShippingCost),
        Total: Math.round(total * 100) / 100,
        GrandTotal: Math.round(grand * 100) / 100,
      };
    });

    const totalPages = Math.ceil(totalDocs / PAGE_SIZE);

    return res.status(200).json({
      success: true,
      message: "Client orders retrieved successfully",
      client: { externalId, name: clientName },
      pagination: {
        page,
        limit: PAGE_SIZE,
        totalDocs,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      data: rows,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

const getSaleOrdersListById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid order id" });
    }

    // ---- Aggregation: 1) pick order by _id  2) join details by OrderID  3) resolve client/user names
    const rows = await SaleOrder.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(id) } },

      // Join all SaleOrderDetails having same OrderID (string)
      {
        $lookup: {
          from: "SaleOrderDetails",
          localField: "OrderID",
          foreignField: "OrderID",
          as: "items",
        },
      },

      // Resolve client name
      {
        $lookup: {
          from: "clients", // <- your clients collection name (check actual)
          let: { extId: "$ClientID" },
          pipeline: [
            { $match: { $expr: { $eq: ["$externalId", "$$extId"] } } },
            { $project: { _id: 0, name: 1, externalId: 1 } },
          ],
          as: "clientDoc",
        },
      },

      // Resolve user name
      {
        $lookup: {
          from: "users", // <- your users collection name (check actual)
          let: { email: { $toLower: { $ifNull: ["$SalesRep", ""] } } },
          pipeline: [
            { $match: { $expr: { $eq: [{ $toLower: "$email" }, "$$email"] } } },
            { $project: { _id: 0, name: 1, email: 1 } },
          ],
          as: "userDoc",
        },
      },

      // Shape output similar to your example
      {
        $addFields: {
          ClientID: { $ifNull: [{ $first: "$clientDoc.name" }, "$ClientID"] },
          SalesRep: { $ifNull: [{ $first: "$userDoc.name" }, "$SalesRep"] },
          itemsCount: { $size: "$items" },
          originals: {
            ClientID: "$ClientID",
            SalesRepEmail: "$SalesRep",
          },
        },
      },

      // Clean extras
      {
        $project: {
          clientDoc: 0,
          userDoc: 0,
          __v: 0,
        },
      },
    ]);

    if (!rows.length) {
      return res
        .status(404)
        .json({ success: false, message: "Sale order not found", data: null });
    }

    // Final payload: keep _id & order fields, include items array
    const order = rows[0];
    const merged = {
      _id: order._id,
      OrderID: order.OrderID,
      Label: order.Label,
      ClientID: order.ClientID, // resolved to name if available
      SalesRep: order.SalesRep, // resolved to name if available

      // Order fields (no duplicate Tracking)
      Tracking: order.Tracking || "",
      TimeStamp: order.TimeStamp,
      Discount: order.Discount,
      PaymentMethod: order.PaymentMethod,
      ShippedDate: order.ShippedDate,
      ShippingMethod: order.ShippingMethod,
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

      // Embedded details
      items: order.items || [],
      itemsCount: order.itemsCount || 0,

      originals: order.originals || {},
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

const getOrdersCountByStatus = async (req, res) => {
  try {
    const externalId = String(req.query.externalId || "").trim();

    const pipeline = [];

    // (0) client filter — only when externalId provided (PERF: sab se pehle)
    if (externalId) {
      pipeline.push({ $match: { ClientID: externalId } });
    }

    // 1) normalize status into _statusNorm
    pipeline.push({
      $addFields: {
        _statusNorm: { $toUpper: { $trim: { input: "$OrderStatus" } } },
      },
    });

    // 2) keep only valid statuses for counting
    pipeline.push({ $match: { _statusNorm: { $in: VALID } } });

    // 3) count per normalized status
    pipeline.push({ $group: { _id: "$_statusNorm", count: { $sum: 1 } } });

    // 4) convert to { COMPLETED: 10, ... }
    pipeline.push(
      { $project: { _id: 0, k: "$_id", v: "$count" } },
      { $group: { _id: null, countsArr: { $push: "$$ROOT" } } },
      { $project: { _id: 0, countsObj: { $arrayToObject: "$countsArr" } } }
    );

    // 5) iterate all statuses (even missing)
    pipeline.push({ $set: { all: VALID } }, { $unwind: "$all" });

    // 6) final rows (missing -> 0) + pretty label
    pipeline.push({
      $project: {
        _id: 0,
        OrderStatus: {
          $ifNull: [{ $getField: { field: "$all", input: LABELS } }, "Unknown"],
        },
        count: {
          $ifNull: [{ $getField: { field: "$all", input: "$countsObj" } }, 0],
        },
      },
    });

    // 7) sort
    pipeline.push({ $sort: { count: -1, OrderStatus: 1 } });

    // single aggregate call
    const data = await SaleOrder.aggregate(pipeline);

    res.status(200).json({
      success: true,
      data,
      message: "Orders count by status retrieved successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* --------------------------------------- CREATE (Order only) ---------------------------------- */
async function createSaleOrder(req, res) {
  try {
    const body = req.body || {};

    // 1) Resolve inputs for SaleOrder
    const resolvedClientId = await resolveClientExternalId(body.ClientID);
    const resolvedSalesRep = await resolveUserEmail(body.SalesRep);
    if (!resolvedClientId)
      return res.status(400).json({
        success: false,
        message: "Client not found (by name or externalId)",
      });
    if (!resolvedSalesRep)
      return res.status(400).json({
        success: false,
        message: "Sales rep not found (by name or email)",
      });

    const required = [
      resolvedClientId,
      resolvedSalesRep,
      body.City,
      body.State,
      body.LockPrices,
      body.OrderStatus,
    ];
    if (required.some((x) => !normalize(x)))
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });

    // 2) Compute base for label auto-increment
    const maxLabelDoc = await SaleOrder.aggregate([
      { $match: { Label: { $type: "string" } } },
      { $addFields: { labelNum: { $toInt: { $ifNull: ["$Label", "0"] } } } },
      { $group: { _id: null, maxLabel: { $max: "$labelNum" } } },
    ]);
    const base = maxLabelDoc[0]?.maxLabel || 0;

    // 3) Atomically get next label number
    const c = await Counter.findOneAndUpdate(
      { _id: "saleOrderLabel" },
      [
        {
          $set: {
            seq: {
              $add: [
                {
                  $cond: [
                    { $or: [{ $not: ["$seq"] }, { $lt: ["$seq", base] }] },
                    base,
                    "$seq",
                  ],
                },
                1,
              ],
            },
          },
        },
      ],
      { new: true, upsert: true }
    ).lean();
    const nextLabel = String(c.seq); // e.g., "52748"

    // 4) Generate unique 8-char OrderID (hex)
    let orderId;
    for (let i = 0; i < 5; i++) {
      const candidate = crypto.randomBytes(4).toString("hex"); // "47f0b67f"
      const exists = await SaleOrder.exists({ OrderID: candidate });
      if (!exists) {
        orderId = candidate;
        break;
      }
    }
    if (!orderId)
      return res
        .status(500)
        .json({ success: false, message: "Failed to allocate OrderID" });

    // 5) Create the SaleOrder (ONLY)
    const saleOrder = await SaleOrder.create({
      ClientID: resolvedClientId, // externalId (string)
      SalesRep: resolvedSalesRep, // email (string)

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
      Tracking: body.Tracking, // keep if you're sending it

      // auto fields
      OrderID: orderId, // 8-char hex, string
      Label: nextLabel, // incremented label, string
      TimeStamp: body.TimeStamp ?? new Date(), // keep existing behavior
    });

    // 6) Done — no detail creation here
    return res.status(200).json({
      success: true,
      message: "Sale order created successfully",
      data: saleOrder,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

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
        return res.status(400).json({
          success: false,
          message: "Client not found (by name or externalId)",
        });
      update.ClientID = resolvedClientId;
    }

    // If caller sent SalesRep (name or email), resolve to email
    if (body.SalesRep !== undefined) {
      const resolvedSalesRep = await resolveUserEmail(body.SalesRep);
      if (!resolvedSalesRep)
        return res.status(400).json({
          success: false,
          message: "Sales rep not found (by name or email)",
        });
      update.SalesRep = resolvedSalesRep;
    }

    const saleOrder = await SaleOrder.findByIdAndUpdate({ _id: id }, update, {
      new: true,
    });

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
  getSaleOrdersByClient,
  getSaleOrdersListById,
  getLatestOrderPerClient,
  getOrdersCountByStatus,
  createSaleOrder,
  updateSaleOrder,
  deleteSaleOrder,
};
