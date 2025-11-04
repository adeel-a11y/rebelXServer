// controllers/auth.js
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User.model"); // adjust path

const loginAccount = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }

    // 1) Find the user
    const user = await User.findOne({ email: String(email).trim().toLowerCase() }).select("+password +status");
    if (!user) {
      // Avoid leaking which field failed
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    // 2) Check status
    if (String(user.status).toLowerCase() !== "active") {
      return res.status(403).json({ success: false, message: "Account is not active. Please contact support." });
    }

    // 3) Compare passwords
    const isMatch = await bcrypt.compare(String(password), user.password || "");
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    // 4) Generate token
    const token = jwt.sign(
      {
        sub: user._id.toString(),
        email: user.email,
        role: user.role || "user",
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    // 5) Optional: update lastLogin
    user.lastLogin = new Date();
    await user.save({ validateModifiedOnly: true });

    // 6) Prepare safe payload
    const safeUser = user.toObject();
    delete safeUser.password;
    delete safeUser.__v;

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,        // omit if using cookie above
      data: safeUser
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  loginAccount,
};
