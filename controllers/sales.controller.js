const SaleOrder = require("../models/SaleOrders");
const Client = require("../models/Client.model");
const User = require("../models/User.model");

/* --------------------------------------- GET ---------------------------------- */
const getSaleOrdersLists = async (req, res) => {
  try {
    let { page = 1, limit = 100 } = req.query;

    // make sure they are numbers >=1
    page = parseInt(page, 10);
    limit = parseInt(limit, 10);
    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1) limit = 100;

    const skip = (page - 1) * limit;

    // run queries in parallel for performance
    const [saleOrders, totalDocs] = await Promise.all([
      SaleOrder.find().skip(skip).limit(limit),
      SaleOrder.countDocuments(),
    ]);

    if (!saleOrders || saleOrders.length === 0) {
      return res.status(200).json({
        success: false,
        message: "Sale orders not found",
        data: [],
        pagination: {
          page,
          limit,
          totalDocs,
          totalPages: Math.ceil(totalDocs / limit) || 0,
          hasNextPage: false,
          hasPrevPage: page > 1,
        },
      });
    }

    const totalPages = Math.ceil(totalDocs / limit);

    return res.status(200).json({
      success: true,
      message: "Sale orders retrieved successfully",
      pagination: {
        page,
        limit,
        totalDocs,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      data: saleOrders,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getSaleOrdersListById = async (req, res) => {
  try {
    const { id } = req.params;
    const saleOrder = await SaleOrder.findById({ _id: id });
    if (!saleOrder)
      return res
        .status(200)
        .json({ success: false, message: "Sale order not found", data: null });
    return res.status(200).json({
      success: true,
      message: "Sale order retrieved successfully",
      data: saleOrder,
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
    const {
      ClientID,
      SalesRep,
      Discount,
      PaymentMethod,
      ShippedDate,
      ShippingMethod,
      ShippingCost,
      Tax,
      Paid,
      ShiptoAddress,
      City,
      State,
      PaymentDate,
      PaymentAmount,
      LockPrices,
      OrderStatus,
    } = req.body;

    if (
      !ClientID ||
      !SalesRep ||
      !City ||
      !State ||
      !LockPrices ||
      !OrderStatus
    )
      return res
        .status(404)
        .json({ success: false, message: "These fields are required" });

    const saleOrder = await SaleOrder.create({
      ClientID,
      SalesRep,
      Discount,
      PaymentMethod,
      ShippedDate,
      ShippingMethod,
      ShippingCost,
      Tax,
      Paid,
      ShiptoAddress,
      City,
      State,
      PaymentDate,
      PaymentAmount,
      LockPrices,
      OrderStatus,
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
    const {
      ClientID,
      SalesRep,
      Discount,
      PaymentMethod,
      ShippedDate,
      ShippingMethod,
      ShippingCost,
      Tax,
      Paid,
      ShiptoAddress,
      City,
      State,
      PaymentDate,
      PaymentAmount,
      LockPrices,
      OrderStatus,
    } = req.body;

    const saleOrder = await SaleOrder.findByIdAndUpdate(
      { _id: id },
      {
        ClientID,
        SalesRep,
        Discount,
        PaymentMethod,
        ShippedDate,
        ShippingMethod,
        ShippingCost,
        Tax,
        Paid,
        ShiptoAddress,
        City,
        State,
        PaymentDate,
        PaymentAmount,
        LockPrices,
        OrderStatus,
      }
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
