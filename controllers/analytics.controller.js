const User = require("../models/User.model");
const Client = require("../models/Client.model");
const Activity = require("../models/Activity.model");

const overviewAnalytics = async (req, res) => {
  try {
    // ===== 1. Date range for CURRENT month =====
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0); // ex: 2025-10-01T00:00:00
    const nextMonthStart = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      1,
      0,
      0,
      0,
      0
    ); // ex: 2025-11-01T00:00:00

    // We'll use this in $match
    const monthMatchStage = {
      createdAt: { $gte: monthStart, $lt: nextMonthStart },
    };

    // ===== 2. All-time pipelines =====
    const userStatsPipeline = [
      {
        $group: {
          _id: null,
          totalUsers: { $sum: 1 },
          activeUsers: {
            $sum: {
              // case-insensitive check for "active"
              $cond: [
                { $eq: [{ $toLower: "$status" }, "active"] },
                1,
                0,
              ],
            },
          },
        },
      },
      { $project: { _id: 0 } },
    ];

    const clientTotalsPipeline = [
      {
        $group: {
          _id: null,
          totalClients: { $sum: 1 },
        },
      },
      { $project: { _id: 0 } },
    ];

    const activityTotalsPipeline = [
      {
        $group: {
          _id: null,
          totalActivities: { $sum: 1 },
        },
      },
      { $project: { _id: 0 } },
    ];

    // ===== 3. Monthly pipelines =====
    const userMonthlyPipeline = [
      { $match: monthMatchStage },
      {
        $group: {
          _id: null,
          monthlyUsers: { $sum: 1 },
          monthlyActiveUsers: {
            $sum: {
              $cond: [
                { $eq: [{ $toLower: "$status" }, "active"] },
                1,
                0,
              ],
            },
          },
        },
      },
      { $project: { _id: 0 } },
    ];

    const clientMonthlyPipeline = [
      { $match: monthMatchStage },
      {
        $group: {
          _id: null,
          monthlyClients: { $sum: 1 },
        },
      },
      { $project: { _id: 0 } },
    ];

    const activityMonthlyPipeline = [
      { $match: monthMatchStage },
      {
        $group: {
          _id: null,
          monthlyActivities: { $sum: 1 },
        },
      },
      { $project: { _id: 0 } },
    ];

    // ===== 4. Run all 6 aggregations in parallel for performance =====
    const [
      userTotalsAgg,
      clientTotalsAgg,
      activityTotalsAgg,
      userMonthlyAgg,
      clientMonthlyAgg,
      activityMonthlyAgg,
    ] = await Promise.all([
      User.aggregate(userStatsPipeline),
      Client.aggregate(clientTotalsPipeline),
      Activity.aggregate(activityTotalsPipeline),
      User.aggregate(userMonthlyPipeline),
      Client.aggregate(clientMonthlyPipeline),
      Activity.aggregate(activityMonthlyPipeline),
    ]);

    // each aggregate returns [] if no docs, so fallback to zeros
    const userTotals =
      userTotalsAgg[0] || { totalUsers: 0, activeUsers: 0 };
    const clientTotals = clientTotalsAgg[0] || { totalClients: 0 };
    const activityTotals =
      activityTotalsAgg[0] || { totalActivities: 0 };

    const userMonthly =
      userMonthlyAgg[0] || {
        monthlyUsers: 0,
        monthlyActiveUsers: 0,
      };
    const clientMonthly =
      clientMonthlyAgg[0] || { monthlyClients: 0 };
    const activityMonthly =
      activityMonthlyAgg[0] || { monthlyActivities: 0 };

    // ===== 5. Send combined response =====
    return res.status(200).json({
      success: true,
      message: "Overview Fetched Successfully",
      data: {
        totals: {
          totalUsers: userTotals.totalUsers,
          activeUsers: userTotals.activeUsers,
          totalClients: clientTotals.totalClients,
          totalActivities: activityTotals.totalActivities,
        },
        thisMonth: {
          monthlyUsers: userMonthly.monthlyUsers,
          monthlyActiveUsers: userMonthly.monthlyActiveUsers,
          monthlyClients: clientMonthly.monthlyClients,
          monthlyActivities: activityMonthly.monthlyActivities,
          monthStart,
          monthEndExclusive: nextMonthStart,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching analytics data:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch analytics data",
    });
  }
};

module.exports = {
  overviewAnalytics,
};
