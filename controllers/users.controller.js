const User = require("../models/User.model");
const mongoose = require("mongoose");

const getUsersLists = async (req, res) => {
  try {
    // --- inputs ---
    const pageRaw  = parseInt(req.query.page, 10);
    const limitRaw = parseInt(req.query.limit, 10);
    const page     = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const perReq   = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20;
    const perPage  = Math.min(perReq, 20); // ✅ hard cap = 20

    const sortBy   = req.query.sortBy || "_id";     // use "createdAt" if your schema has timestamps
    const sortDir  = (req.query.sort || "desc").toLowerCase() === "asc" ? 1 : -1;
    const sort     = { [sortBy]: sortDir };

    const skip = (page - 1) * perPage;

    // --- query (add filters later if needed) ---
    const where = {};

    const [total, users] = await Promise.all([
      User.countDocuments(where),
      User.find(where)
        .sort(sort)
        .skip(skip)
        .limit(perPage)
        .select("-password -hash -salt -__v") // 🔒 avoid sensitive fields if present
        .lean(),
    ]);

    const totalPages = Math.max(Math.ceil(total / perPage), 1);

    return res.status(200).json({
      success: true,
      message: "Users retrieved successfully",
      page,
      perPage,
      total,
      totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
      prevPage: page > 1 ? page - 1 : null,
      nextPage: page < totalPages ? page + 1 : null,
      data: users,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};


const getUsersListById = async (req, res) => {
  try {
    const usersListById = await User.findById(req.params.id);
    return res
      .status(200)
      .json({
        success: true,
        message: "User retrieved successfully",
        count: usersListById.length,
        data: usersListById,
      });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

const createUserList = async (req, res) => {
  try {
    const usersList = await User.create(req.body);
    return res
      .status(201)
      .json({
        success: true,
        message: "User created successfully",
        data: usersList,
      });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

const updateUserList = async (req, res) => {
  try {
    const usersList = await User.findByIdAndUpdate(req.params.id, req.body);
    return res
      .status(200)
      .json({
        success: true,
        message: "User updated successfully",
        data: usersList,
      });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

const deleteUserList = async (req, res) => {
  try {
    const usersList = await User.findByIdAndDelete(req.params.id);
    return res
      .status(200)
      .json({
        success: true,
        message: "User deleted successfully",
        data: usersList,
      });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getUsersLists,
  getUsersListById,
  createUserList,
  updateUserList,
  deleteUserList,
};
