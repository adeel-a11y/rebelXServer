const SaleOrder = require("../models/SaleOrders");

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

    const saleOrder = await SaleOrder.findByIdAndUpdate({ _id: id }, {
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

    if (!id) return res.status(404).json({ success: false, message: "ID is required" });

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
  createSaleOrder,
  updateSaleOrder,
  deleteSaleOrder,
};
