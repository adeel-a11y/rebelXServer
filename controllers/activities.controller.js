const Activity = require("../models/Activity.model");

// GET /api/activities/lists?page=1&limit=20&sortBy=createdAt&sort=desc
const getActivitiesLists = async (req, res) => {
  try {
    // ---- inputs ----
    const pageRaw = parseInt(req.query.page, 10);
    const limitRaw = parseInt(req.query.limit, 10);

    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const perReq = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20;
    const perPage = Math.min(perReq, 20); // ✅ hard cap: 20

    const sortBy = req.query.sortBy || "createdAt"; // fallback to _id if no timestamps
    const sortDir = (req.query.sort || "desc").toLowerCase() === "asc" ? 1 : -1;
    const sort = { [sortBy]: sortDir };

    const skip = (page - 1) * perPage;

    // ---- optional filters (future-proof) ----
    const where = {};
    if (req.query.actor) where.actor = req.query.actor; // e.g., userId
    if (req.query.verb) where.verb = req.query.verb; // e.g., "CREATE","UPDATE"
    if (req.query.q) {
      const rx = new RegExp(req.query.q, "i");
      where.$or = [{ message: rx }, { notes: rx }];
    }

    // ---- query ----
    const [total, activities] = await Promise.all([
      Activity.countDocuments(where),
      Activity.find(where).sort(sort).skip(skip).limit(perPage).lean(),
    ]);

    const totalPages = Math.max(Math.ceil(total / perPage), 1);

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
      data: activities,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const getActivitiesListById = async (req, res) => {
  try {
    const activitiesListById = await Activity.findById({ _id: req.params.id });
    return res.status(200).json({
      success: true,
      message: "Activity retrieved successfully",
      data: activitiesListById,
      count: activitiesListById.length,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

const createActivityList = async (req, res) => {
  try {
    const activitiesList = await Activity.create(req.body);
    return res.status(201).json(activitiesList);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

const updateActivityList = async (req, res) => {
  try {
    const activitiesList = await Activity.findByIdAndUpdate(
      { _id: req.params.id },
      req.body
    );
    return res.status(200).json(activitiesList);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

const deleteActivityList = async (req, res) => {
  try {
    const activitiesList = await Activity.findByIdAndDelete({
      _id: req.params.id,
    });
    return res.status(200).json(activitiesList);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getActivitiesLists,
  getActivitiesListById,
  createActivityList,
  updateActivityList,
  deleteActivityList,
};
