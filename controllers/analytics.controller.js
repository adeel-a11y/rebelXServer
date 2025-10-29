const User = require("../models/User.model");
const Client = require("../models/Client.model");
const Activity = require("../models/Activity.model");

const overviewAnalytics = async (req, res) => {
  try {
    // ===== 1. Date range for CURRENT month =====
    const now = new Date();
    const monthStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
      0,
      0,
      0,
      0
    ); // ex: 2025-10-01T00:00:00
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
              $cond: [{ $eq: [{ $toLower: "$status" }, "active"] }, 1, 0],
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
              $cond: [{ $eq: [{ $toLower: "$status" }, "active"] }, 1, 0],
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
    const userTotals = userTotalsAgg[0] || { totalUsers: 0, activeUsers: 0 };
    const clientTotals = clientTotalsAgg[0] || { totalClients: 0 };
    const activityTotals = activityTotalsAgg[0] || { totalActivities: 0 };

    const userMonthly = userMonthlyAgg[0] || {
      monthlyUsers: 0,
      monthlyActiveUsers: 0,
    };
    const clientMonthly = clientMonthlyAgg[0] || { monthlyClients: 0 };
    const activityMonthly = activityMonthlyAgg[0] || { monthlyActivities: 0 };

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

const monthlyNewClients = async (req, res) => {
  try {
    // ----- 1. Calculate date window (last 12 months including current month) -----
    const now = new Date();

    // first day of current month @ 00:00
    const thisMonthStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
      0,
      0,
      0,
      0
    );

    // first day of next month @ 00:00
    const nextMonthStart = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      1,
      0,
      0,
      0,
      0
    );

    // 11 months back from start of this month -> gives us 12 months total
    const startDate = new Date(
      thisMonthStart.getFullYear(),
      thisMonthStart.getMonth() - 11,
      1,
      0,
      0,
      0,
      0
    );

    const endDate = nextMonthStart;

    // ----- 2. Aggregation -----
    const aggResult = await Client.aggregate([
      //
      // STEP A: Add a real Date field `createdAtDate` from your string "M/D/YYYY"
      //
      {
        $addFields: {
          createdAtDate: {
            $cond: [
              // if createdAt is already a BSON Date
              { $eq: [{ $type: "$createdAt" }, "date"] },

              // THEN: just use it directly
              "$createdAt",

              // ELSE: assume it's a string like "9/9/2020" and parse it
              {
                $let: {
                  vars: {
                    parts: { $split: ["$createdAt", "/"] },
                    // parts[0] = month
                    // parts[1] = day
                    // parts[2] = year
                  },
                  in: {
                    $dateFromParts: {
                      year: { $toInt: { $arrayElemAt: ["$$parts", 2] } },
                      month: { $toInt: { $arrayElemAt: ["$$parts", 0] } },
                      day: { $toInt: { $arrayElemAt: ["$$parts", 1] } },
                      hour: 0,
                      minute: 0,
                      second: 0,
                      millisecond: 0,
                    },
                  },
                },
              },
            ],
          },
        },
      },

      //
      // STEP B: only keep docs in our last-12-months window
      //
      {
        $match: {
          createdAtDate: { $gte: startDate, $lt: endDate },
        },
      },

      //
      // STEP C: group by year+month of that parsed date
      //
      {
        $group: {
          _id: {
            year: { $year: "$createdAtDate" },
            month: { $month: "$createdAtDate" },
          },
          count: { $sum: 1 },
        },
      },

      //
      // STEP D: shape the output nicely
      //
      {
        $project: {
          _id: 0,
          year: "$_id.year",
          month: "$_id.month",
          count: 1,
        },
      },
      {
        $sort: { year: 1, month: 1 },
      },
    ]);

    // ----- 3. Build lookup map: { "2025-10": 42, ... }
    const countMap = {};
    for (const row of aggResult) {
      const key = `${row.year}-${String(row.month).padStart(2, "0")}`;
      countMap[key] = row.count;
    }

    // ----- 4. Generate last 12 months in order and fill missing with 0 -----
    const finalData = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(
        thisMonthStart.getFullYear(),
        thisMonthStart.getMonth() - i,
        1,
        0,
        0,
        0,
        0
      );

      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0"); // +1 because getMonth() is 0-based
      const key = `${y}-${m}`;

      finalData.push({
        month: key, // "2025-10"
        newClients: countMap[key] ?? 0, // fill 0 if no data
      });
    }

    // ----- 5. Send response -----
    return res.status(200).json({
      success: true,
      message: "Monthly new clients (last 12 months)",
      data: finalData,
      meta: {
        rangeStart: startDate,
        rangeEndExclusive: endDate,
        buckets: finalData.length,
      },
    });
  } catch (err) {
    console.error("Error in monthlyNewClients:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch monthly new clients",
      error: err.message,
    });
  }
};

const getTopUsersByActivity = async (req, res) => {
  try {
    const pipeline = [
      // 1) group all activities by userId (email in DB)
      {
        $group: {
          _id: "$userId", // this is the user's email in the raw Activity docs
          activityCount: { $sum: 1 },
          lastActivityAt: { $max: "$createdAt" }, // Date
        },
      },

      // 2) join with usersdb to get the user's profile info
      {
        $lookup: {
          from: "usersdb", // <-- collection name from your User model
          localField: "_id", // userId from Activity (email)
          foreignField: "email", // email from User
          as: "userInfo",
        },
      },

      // 3) add friendly fields
      {
        $addFields: {
          // extract first (and only) match from lookup
          name: {
            $ifNull: [{ $arrayElemAt: ["$userInfo.name", 0] }, "$_id"],
          },
          role: { $arrayElemAt: ["$userInfo.role", 0] },
          status: { $arrayElemAt: ["$userInfo.status", 0] },
        },
      },

      // 4) final shape of each row
      {
        $project: {
          _id: 0,
          email: "$_id",
          name: 1,
          role: 1,
          status: 1,
          activityCount: 1,
          lastActivityAt: 1,
        },
      },

      // 5) sort by most active first (and break ties by recency)
      { $sort: { activityCount: -1, lastActivityAt: -1 } },

      // 6) only top 5
      { $limit: 5 },
    ];

    const results = await Activity.aggregate(pipeline);

    return res.status(200).json({
      success: true,
      message: "Top active users fetched successfully",
      data: results,
    });
  } catch (error) {
    console.error("Error in getTopUsersByActivity:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch top active users",
      error: error.message,
    });
  }
};

const contactStatusBreakdown = async (req, res) => {
  try {
    const pipeline = [
      // only include docs where contactStatus actually exists and isn't empty
      {
        $match: {
          contactStatus: { $exists: true, $ne: null, $ne: "" },
        },
      },

      // group by contactStatus
      {
        $group: {
          _id: "$contactStatus",
          value: { $sum: 1 },
        },
      },

      // sort most common first
      {
        $sort: { value: -1 },
      },

      // reshape for clean response
      {
        $project: {
          _id: 0,
          name: "$_id",
          value: 1,
        },
      },
    ];

    const breakdown = await Client.aggregate(pipeline);

    // also get total clients (you can also just do Client.countDocuments() if you want ALL docs)
    const totalClients = await Client.countDocuments();

    return res.status(200).json({
      success: true,
      message: "Clients grouped by contactStatus",
      data: breakdown,
      meta: {
        totalClients,
        groups: breakdown.length,
      },
    });
  } catch (err) {
    console.error("Error in contactStatusBreakdown:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch contact status breakdown",
      error: err.message,
    });
  }
};

const companyTypeBreakdown = async (req, res) => {
  try {
    const pipeline = [
      {
        $match: {
          companyType: { $exists: true, $ne: null, $ne: "" },
        },
      },
      {
        $group: {
          _id: "$companyType",
          value: { $sum: 1 },
        },
      },
      {
        $sort: { value: -1 },
      },
      {
        $project: {
          _id: 0,
          name: "$_id",
          value: 1,
        },
      },
    ];

    const breakdown = await Client.aggregate(pipeline);

    const totalClients = await Client.countDocuments();

    return res.status(200).json({
      success: true,
      message: "Clients grouped by companyType",
      data: breakdown,
      meta: {
        totalClients,
        groups: breakdown.length,
      },
    });
  } catch (err) {
    console.error("Error in companyTypeBreakdown:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch company type breakdown",
      error: err.message,
    });
  }
};

const contactTypeBreakdown = async (req, res) => {
  try {
    const pipeline = [
      {
        $match: {
          contactType: { $exists: true, $ne: null, $ne: "" },
        },
      },
      {
        $group: {
          _id: "$contactType",
          value: { $sum: 1 },
        },
      },
      {
        $sort: { value: -1 },
      },
      {
        $project: {
          _id: 0,
          name: "$_id",
          value: 1,
        },
      },
    ];

    const breakdown = await Client.aggregate(pipeline);

    const totalClients = await Client.countDocuments();

    return res.status(200).json({
      success: true,
      message: "Clients grouped by contactType",
      data: breakdown,
      meta: {
        totalClients,
        groups: breakdown.length,
      },
    });
  } catch (err) {
    console.error("Error in contactTypeBreakdown:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch contact type breakdown",
      error: err.message,
    });
  }
};


module.exports = {
  overviewAnalytics,
  monthlyNewClients,
  getTopUsersByActivity,
  contactStatusBreakdown,
  companyTypeBreakdown,
  contactTypeBreakdown,
};
