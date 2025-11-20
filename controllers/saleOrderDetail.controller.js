const SaleOrderDetail = require("../models/SaleOrderDetails");
const crypto = require("crypto");

/* --------------------------------------- GET ---------------------------------- */
const getSaleOrderDetailsLists = async (req, res) => {
  try {
    let { page = 1, limit = 100 } = req.query;

    // make sure they are numbers >=1
    page = parseInt(page, 10);
    limit = parseInt(limit, 10);
    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1) limit = 100;

    const skip = (page - 1) * limit;

    // run queries in parallel for performance
    const [saleOrderDetails, totalDocs] = await Promise.all([
      SaleOrderDetail.find().skip(skip).limit(limit),
      SaleOrderDetail.countDocuments(),
    ]);

    if (!saleOrderDetails || saleOrderDetails.length === 0) {
      return res.status(200).json({
        success: false,
        message: "Sale order details not found",
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
      message: "Sale order details retrieved successfully",
      pagination: {
        page,
        limit,
        totalDocs,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      data: saleOrderDetails,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getSaleOrderDetailById = async (req, res) => {
  try {
    const { id } = req.params;
    const saleOrderDetail = await SaleOrderDetail.findById({ _id: id });
    if (!saleOrderDetail)
      return res.status(200).json({
        success: false,
        message: "Sale order detail not found",
        data: null,
      });
    return res.status(200).json({
      success: true,
      message: "Sale order detail retrieved successfully",
      data: saleOrderDetail,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* --------------------------------------- CREATE ---------------------------------- */
const createSaleOrderDetail = async (req, res) => {
  try {
    const {
      OrderID,
      Warehouse,
      SKU,
      Description,
      LotNumber,
      QtyShipped,
      UOM,
      Price,
      Total,
    } = req.body;
    console.log("data", req.body);

    if (!Warehouse || !SKU || !Price || !Total) {
      return res
        .status(404)
        .json({ success: false, message: "These fields are required" });
    }

    const recordId = crypto.randomBytes(4).toString("hex");
    // const OrderID = uuidv4();

    console.log(req.body, recordId);

    const saleOrderDetail = await SaleOrderDetail.create({
      RecordID: recordId,
      OrderID,
      Warehouse,
      SKU,
      Description,
      LotNumber,
      QtyShipped,
      UOM,
      Price,
      Total,
    });

    console.log("saleOrderDetail", saleOrderDetail);
    return res.status(200).json({
      success: true,
      message: "Sale order detail created successfully",
      data: saleOrderDetail,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* --------------------------------------- UPDATE ---------------------------------- */
const updateSaleOrderDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      Warehouse,
      SKU,
      Description,
      LotNumber,
      QtyShipped,
      UOM,
      Price,
      Total,
    } = req.body;

    console.log("id", id);
    console.log("payload", req.body);

    if (!id)
      return res
        .status(404)
        .json({ success: false, message: "ID is required" });

    const isExist = await SaleOrderDetail.findById({ _id: id });
    if (!isExist)
      return res
        .status(404)
        .json({ success: false, message: "Sale order detail not found" });

    const saleOrderDetail = await SaleOrderDetail.findByIdAndUpdate(
      { _id: id },
      {
        RecordID: isExist.RecordID,
        OrderID: isExist.OrderID,
        Warehouse,
        SKU,
        Description,
        LotNumber,
        QtyShipped,
        UOM,
        Price,
        Total,
      }
    );

    return res.status(200).json({
      success: true,
      message: "Sale order detail updated successfully",
      data: saleOrderDetail,
    });
  } catch (err) {
    console.log("err", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* --------------------------------------- DELETE ---------------------------------- */
const deleteSaleOrderDetail = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id)
      return res
        .status(404)
        .json({ success: false, message: "ID is required" });

    const saleOrderDetail = await SaleOrderDetail.findByIdAndDelete({
      _id: id,
    });

    return res.status(200).json({
      success: true,
      message: "Sale order detail deleted successfully",
      data: saleOrderDetail,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getSaleOrderDetailsLists,
  getSaleOrderDetailById,
  createSaleOrderDetail,
  updateSaleOrderDetail,
  deleteSaleOrderDetail,
};
