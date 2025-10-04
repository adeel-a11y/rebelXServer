const express = require("express");
const { getUsersLists, getUsersListById, createUserList, updateUserList, deleteUserList } = require("../controllers/users.controller");

const router = express.Router();

// GET
router.get("/lists", getUsersLists);
router.get("/lists/:id", getUsersListById);

// POST
router.post("/", createUserList);

// PUT
router.put("/update/:id", updateUserList);

// DELETE
router.delete("/delete/:id", deleteUserList);

module.exports = router;
