const Client = require("../models/Client.model");

// GET /api/clients?page=1&limit=20&sortBy=createdAt&sort=desc
const getClientsLists = async (req, res) => {
  try {
    // 1) Inputs (with sane defaults and caps)
    const pageRaw = parseInt(req.query.page, 10);
    const limitRaw = parseInt(req.query.limit, 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const limitReq = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20;
    const perPage = Math.min(limitReq, 20); // ✅ hard cap: 20 per page (as requested)

    const sortBy = req.query.sortBy || "createdAt"; // fallback to createdAt (or use '_id' if no createdAt)
    const sortDir = (req.query.sort || "desc").toLowerCase() === "asc" ? 1 : -1;
    const sort = { [sortBy]: sortDir };

    const skip = (page - 1) * perPage;

    // 2) Query
    // (optional) add filters in a "where" object if needed later
    const where = {};

    const [total, clients] = await Promise.all([
      Client.countDocuments(where),
      Client.find(where).sort(sort).skip(skip).limit(perPage).lean(),
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
      data: clients,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

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
    const clientsList = await Client.findByIdAndUpdate(req.params.id, req.body);
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
  getClientsListById,
  createClientList,
  updateClientList,
  deleteClientList,
};
