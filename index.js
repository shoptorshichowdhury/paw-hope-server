require("dotenv").config();
const express = require("express");
const cors = require("cors");

const port = process.env.PORT || 5000;
const app = express();

// middleware
app.use(express.json());


app.get("/", (req, res) => {
    res.send("Hello from paw-hope Server..");
  });
  
  app.listen(port, () => {
    console.log(`paw-hope is running on port ${port}`);
  });