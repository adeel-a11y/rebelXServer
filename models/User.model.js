const mongoose = require("mongoose");

// User Schema with email as _id for unique identification
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters long"],
      maxlength: [100, "Name cannot exceed 100 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        "Please provide a valid email",
      ],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters long"],
      select: false, // Don't return password by default in queries
    },
    role: {
      type: String,
      required: [true, "Role is required"],
      enum: {
        values: ["admin", "manager", "employee","sales-agent", "shipping", "sales", "warehouse", "sales-executive"],
        message: "Role must be either admin, manager, or employee",
      },
    },
    department: {
      type: String,
      trim: true,
      maxlength: [100, "Department cannot exceed 100 characters"],
    },
    phone: {
      type: String,
      trim: true,
      match: [
        /^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/,
        "Please provide a valid phone number",
      ],
    },
    hourlyRate: {
      type: String,
      min: [0, "Hourly rate cannot be negative"],
      max: [10000, "Hourly rate seems unrealistic"],
    },
    status: {
      type: String,
      enum: {
        values: ["active", "inactive"],
        message: "Status must be either active or inactive",
      },
      default: "active",
    },
  },
  {
    timestamps: true,
  }
);

userSchema.index({ name: 1, email: 1, phone: 1, role: 1, status: 1, department: 1 });

module.exports =
  mongoose.models.User || mongoose.model("User", userSchema, "usersdb"); 
