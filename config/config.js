const mongoose = require("mongoose");

const dbConnection = async () => {
  try {
    const connect = await mongoose.connect(
      "mongodb+srv://adeeljabbar:adeel123@cluster1.2ttstsb.mongodb.net/?retryWrites=true&w=majority&appName=Cluster1",
      { dbName: "rebelXdb" }
    );
    console.log("Mongo Db Connection successfully");
  } catch (error) {
    console.log("error mongo db connection == >", error);
  }
};

module.exports = {
  dbConnection,
};
