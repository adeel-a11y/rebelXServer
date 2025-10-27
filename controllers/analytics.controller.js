const User = require("../models/User.model");
const Client = require("../models/Client.model");
const Activity = require("../models/Activity.model");

const overviewAnalytics = async (req, res) => {
  try {
    const userStatsPipeline = [
      {
        $group: {
          _id: null,
          totalUsers: { $sum: 1 },
          activeUsers: {
            $sum: {
              $cond: [{ $eq: ["$status", "active"] }, 1, 0],
            },
          },
        },
      },
      { $project: { _id: 0 } },
    ];

    const clientPipelines = [
      {
        $group: {
          _id: null,
          totalClients: { $sum: 1 },
        },
      },
      { $project: { _id: 0 } },
    ];

    const activityPipeline = [
      {
        $group: {
          _id: null,
          totalActivities: { $sum: 1 },
        },
      },
      { $project: { _id: 0 } },
    ];

    const userStats = await User.aggregate(userStatsPipeline);
    const clientStats = await Client.aggregate(clientPipelines);
    const activityStats = await Activity.aggregate(activityPipeline);

    return res
      .status(200)
      .json({
        success: true,
        message: "Overview Fetched Successfully",
        user: userStats[0],
        client: clientStats[0],
        activity: activityStats[0],
      });
  } catch (error) {
    console.error("Error fetching analytics data:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch analytics data" });
  }
};

module.exports = {
  overviewAnalytics,
};
