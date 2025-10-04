const mongoose = require("mongoose");

// Client Schema with comprehensive CRM fields
const clientSchema = new mongoose.Schema(
  {
    // Legacy/External Identifier (from CSV like Client_id)
    externalId: {
      type: String,
      trim: true,
    },
    // Basic Information
    name: {
      type: String,
      required: [true, "Client name is required"],
      trim: true,
      maxlength: [200, "Client name cannot exceed 200 characters"],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, "Description cannot exceed 1000 characters"],
    },
    ownedBy: {
      type: String, // References User by email (_id)
    },

    // Contact Status and Type
    contactStatus: {
      type: String,
      enum: {
        values: [
          "Sampling",
          "New Prospect",
          "Uncategorized",
          "Closed lost",
          "Initial Contact",
          "Closed won",
          "Committed",
          "Consideration",
        ],
        message: "Invalid contact status",
      },
      default: "New Prospect",
    },
    contactType: {
      type: String,
      trim: true,
      maxlength: [50, "Contact type cannot exceed 50 characters"],
    },
    companyType: {
      type: String,
      trim: true,
      maxlength: [100, "Company type cannot exceed 100 characters"],
    },

    // Contact Information
    phone: {
      type: String,
      trim: true,
      match: [
        /^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/,
        "Please provide a valid phone number",
      ],
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        "Please provide a valid email",
      ],
    },

    // Address Information
    address: {
      type: String,
      trim: true,
      maxlength: [200, "Address cannot exceed 200 characters"],
    },
    city: {
      type: String,
      trim: true,
      maxlength: [100, "City cannot exceed 100 characters"],
    },
    state: {
      type: String,
      trim: true,
      maxlength: [100, "State cannot exceed 100 characters"],
    },
    postalCode: {
      type: String,
      trim: true,
      maxlength: [20, "Postal code cannot exceed 20 characters"],
    },

    // Online Presence
    website: {
      type: String,
      trim: true,
      match: [/^https?:\/\/.+/, "Please provide a valid URL"],
    },
    facebookPage: {
      type: String,
      trim: true,
      match: [/^https?:\/\/.+/, "Please provide a valid Facebook URL"],
    },

    // Business Information
    industry: {
      type: String,
      trim: true,
      maxlength: [100, "Industry cannot exceed 100 characters"],
    },
    forecastedAmount: {
      type: Number,
      default: 0,
      min: [0, "Forecasted amount cannot be negative"],
    },
    interactionCount: {
      type: Number,
      default: 0,
      min: [0, "Interaction count cannot be negative"],
    },

    // Additional Information
    profileImage: {
      type: String, // URL to client's profile image
    },
    folderLink: {
      type: String,
      trim: true,
      maxlength: [500, "Folder link cannot exceed 500 characters"],
    },
    // Legacy payment text fields (non-PCI sensitive): store only safe representations
    nameOnCard: {
      type: String,
      trim: true,
      maxlength: [150, "NameCC cannot exceed 150 characters"],
    },
    expirationDateText: {
      type: Number,
      trim: true,
      maxlength: [20, "ExpirationDate text cannot exceed 20 characters"],
    },
    ccNumberText: {
      type: Number,
      trim: true,
      maxlength: [30, "CCNumber text cannot exceed 30 characters"],
    },
    securityCodeText: {
      type: Number,
      trim: true,
      maxlength: [10, "SecurityCode text cannot exceed 10 characters"],
    },
    zipCodeText: {
      type: String,
      trim: true,
      maxlength: [20, "ZipCode text cannot exceed 20 characters"],
    },
    lastNote: {
      type: String,
      trim: true,
      maxlength: [500, "Last note cannot exceed 500 characters"],
    },
    projectedCloseDate: {
      type: Date,
    },
    fullName: {
      type: String,
      trim: true,
      maxlength: [200, "Full name cannot exceed 200 characters"],
    },
    defaultShippingTerms: {
      type: String,
      trim: true,
      maxlength: [200, "Shipping terms cannot exceed 200 characters"],
    },
    defaultPaymentMethod: {
      type: String,
      trim: true,
      maxlength: [100, "Payment method cannot exceed 100 characters"],
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

module.exports = mongoose.model("Client", clientSchema, "clients");
