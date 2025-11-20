const mongoose = require("mongoose");

// Activity Schema for tracking all client interactions and events
const activitySchema = new mongoose.Schema(
  {
    // Reference to the client this activity belongs to
    clientId: {
      type: String,
      required: [true, "Client ID is required for activity"],
    },

    // Reference to the user who performed the activity (using email as _id)
    userId: {
      type: String,
      required: [true, "User ID is required for activity"],
    },
    trackingId: {
      type: String,
      required: [true, "User ID is required for activity"],
    },

    // Type of activity performed
    type: {
      type: String,
      required: [true, "Activity type is required"],
      enum: {
        values: ["Call", "Email", "Text", "call_made", "status_changed", "note_added", "email_sent", "meeting_scheduled", "created"],
        message: "Invalid activity type",
      },
      index: true, // Index for filtering by activity type
    },

    // Human-readable description of the activity
    description: {
      type: String,
      required: [true, "Activity description is required"],
      trim: true,
      maxlength: [500, "Description cannot exceed 500 characters"],
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
  }
);

activitySchema.index({ type: 1, createdAt: -1 });

module.exports = mongoose.model("Activity", activitySchema, "activity");
