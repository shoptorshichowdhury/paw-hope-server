require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);

const port = process.env.PORT || 5000;
const app = express();

// middleware
const corsOptions = {
  origin: [
    "http://localhost:5173",
    "http://localhost:5176",
    "https://paw-hope.netlify.app",
  ],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(express.json());
app.use(cookieParser());
app.use(cors(corsOptions));

/* verify token */
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.access_token;

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.user = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.07iu7.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const db = client.db("paw-hopeDB");
    const userCollection = db.collection("users");
    const petsCollection = db.collection("pets");
    const adoptionRequests = db.collection("adopt-requests");
    const donationCampaigns = db.collection("donation-campaigns");
    const donations = db.collection("donations");

    //Generate JWT token
    app.post("/jwt", async (req, res) => {
      const email = req.body;
      const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });
      res
        .cookie("access_token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    //Logout (jwt)
    app.get("/logout", async (req, res) => {
      try {
        res
          .clearCookie("access_token", {
            maxAge: 0,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          })
          .send({ success: true });
      } catch (err) {
        res.status(500).send(err);
      }
    });

    //verify admin
    const verifyAdmin = async (req, res, next) => {
      const email = req.user?.email;
      const query = { email };
      const result = await userCollection.findOne(query);
      if (!result || result?.role !== "admin")
        return res
          .status(403)
          .send({ message: "Forbidden Access! Admin Only Actions!" });

      next();
    };

    /*----------------- admin api--------------- */
    //get all users for admin
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    //make admin api
    app.patch(
      "/users/role/:email",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;
        const filter = { email };
        const updateDoc = {
          $set: {
            role: "admin",
          },
        };
        const result = await userCollection.updateOne(filter, updateDoc);
        res.send(result);
      }
    );

    //get all pets
    app.get("/all-pets", verifyToken, verifyAdmin, async (req, res) => {
      const result = await petsCollection.find().toArray();
      res.send(result);
    });

    //save/update user in db
    app.post("/users/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const query = { email };

      //Check if user exists in db
      const isExist = await userCollection.findOne(query);
      if (isExist) {
        return res.send(isExist);
      }

      const result = await userCollection.insertOne({
        ...user,
        role: "user",
      });
      res.send(result);
    });

    //Get user role
    app.get("/users/role/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const result = await userCollection.findOne({ email });
      res.send({ role: result?.role });
    });

    //get all donation campaigns
    app.get(
      "/all-donation-campaigns",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const result = await donationCampaigns.find().toArray();
        res.send(result);
      }
    );

    //delete api for delete donation
    app.delete("/donations/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const result = await donationCampaigns.deleteOne(filter);
      res.send(result);
    });

    /* ---------------pets---------------- */
    //get all pets from db
    app.get("/pets", async (req, res) => {
      const filter = req.query.filter;
      const search = req.query.search;
      const sort = req.query.sort;

      const page = parseInt(req.query._page) || 1;
      const limit = 4;
      const skip = (page - 1) * limit;

      let query = { adopted: false };

      // For search
      if (search) {
        query.name = {
          $regex: search,
          $options: "i",
        };
      }

      // For filter (category)
      if (filter) {
        query.category = filter;
      }

      //for sort
      let options = {};
      if (sort) options = { sort: { price: sort === "asc" ? 1 : -1 } };

      const result = await petsCollection
        .find(query, options)
        // .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      res.send(result);
    });

    //get pets for specific user
    app.get("/pets/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { "petOwner.email": email };
      const result = await petsCollection.find(query).toArray();
      res.send(result);
    });

    //get single pet data
    app.get("/pet/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const result = await petsCollection.findOne(query);
      res.send(result);
    });

    //add a pet in db
    app.post("/pets", verifyToken, async (req, res) => {
      const petData = req.body;
      const result = await petsCollection.insertOne({
        ...petData,
        timestamp: Date.now(),
        adopted: false,
      });
      res.send(result);
    });

    //update a pet in db
    app.put("/pets/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const petInfo = req.body;
      const filter = { _id: new ObjectId(id) };

      const updateDoc = {
        $set: {
          photo: petInfo.photo,
          name: petInfo.name,
          age: petInfo.age,
          category: petInfo.category,
          location: petInfo.location,
          shortDescription: petInfo.shortDescription,
          longDescription: petInfo.longDescription,
        },
      };
      const result = await petsCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    //save adoption request to db
    app.post("/adoption-requests", verifyToken, async (req, res) => {
      const adoptionRequestData = req.body;
      const result = await adoptionRequests.insertOne(adoptionRequestData);
      res.send(result);
    });

    //Get adoption request for specific user
    app.get("/adoption-request/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { petOwnerInfo: email };
      const result = await adoptionRequests.find(query).toArray();
      res.send(result);
    });

    //delete pet from db
    app.delete("/delete-pet/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await petsCollection.deleteOne(query);
      res.send(result);
    });

    //delete adoption request from db
    app.delete(
      "/delete-adoption-request/:id",
      verifyToken,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await adoptionRequests.deleteOne(query);
        res.send(result);
      }
    );

    //adopt pet (patch)
    app.patch("/adopt-pet/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          adopted: status,
        },
      };
      const result = await petsCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    /* ----------------------donation------------------------ */
    //get all donation campaigns
    app.get("/donation-campaigns", async (req, res) => {
      const page = parseInt(req.query._page) || 1;
      const limit = 3;
      const skip = (page - 1) * limit;

      const result = await donationCampaigns
        .find()
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      res.send(result);
    });

    //get single donation campaign
    app.get("/donation-campaign/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await donationCampaigns.findOne(query);
      res.send(result);
    });

    //save donation campaign in db
    app.post("/donation-campaigns", verifyToken, async (req, res) => {
      const donationData = req.body;
      const result = await donationCampaigns.insertOne({
        ...donationData,
        status: "Active",
        timestamp: Date.now(),
      });
      res.send(result);
    });

    //save donation in db
    app.post("/donations", verifyToken, async (req, res) => {
      const { campaignId, donationAmount, donator, petName, petImage } =
        req.body;
      const query = { _id: new ObjectId(campaignId) };

      //check the campaign status
      const campaign = await donationCampaigns.findOne(query);
      if (campaign.status === "Pause")
        return res.status(400).send({
          message: "This campaign is paused now. Donation are not allowed!",
        });

      //add the donation in donation collection
      const donationInfo = {
        campaignId,
        donationAmount,
        petName,
        petImage,
        donator,
      };
      const result = await donations.insertOne(donationInfo);
      res.send(result);
    });

    //get donations for specific user (donation seeker)
    app.get("/donator-list/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { campaignId: id };
      const result = await donations.find(query).toArray();
      res.send(result);
    });

    //delete donatin from db
    app.delete("/refund-donation/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await donations.deleteOne(query);
      res.send(result);
    });

    //Change the donated amount (donation campaign)
    app.patch(
      "/donation-campaign/donatedAmount/:id",
      verifyToken,
      async (req, res) => {
        const id = req.params.id;
        const { donationAmount, status } = req.body;
        const filter = { _id: new ObjectId(id) };
        let updateDoc;

        if (status === "decrease") {
          updateDoc = {
            $inc: { donatedAmount: -donationAmount },
          };
        } else {
          updateDoc = {
            $inc: { donatedAmount: donationAmount },
          };
        }

        const result = await donationCampaigns.updateOne(filter, updateDoc);
        res.send(result);
      }
    );

    //active 3 donations (donation details page)
    app.get("/active-donations", async (req, res) => {
      const query = { status: "Active" };
      const result = await donationCampaigns.find(query).limit(3).toArray();
      res.send(result);
    });

    //Get donation campaigns for specific user
    app.get("/my-donation-campaigns/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { "askerInfo.email": email };
      const result = await donationCampaigns.find(query).toArray();
      res.send(result);
    });

    //Get donation data for specific user (donator)
    app.get("/my-donations/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { "donator.email": email };
      const result = await donations.find(query).toArray();
      res.send(result);
    });

    //update a donation campaign
    app.put("/update-donation-campaign/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const donationInfo = req.body;
      const filter = { _id: new ObjectId(id) };

      const updateDoc = {
        $set: {
          petName: donationInfo.petName,
          petImage: donationInfo.petImage,
          maxAmount: donationInfo.maxAmount,
          lastDate: donationInfo.lastDate,
          shortDescription: donationInfo.shortDescription,
          longDescription: donationInfo.longDescription,
        },
      };
      const result = await donationCampaigns.updateOne(filter, updateDoc);
      res.send(result);
    });

    //change donation campaign status (patch)
    app.patch("/donation-status/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const { status } = req.body;

      const updateDoc = {
        $set: {
          status: status,
        },
      };

      const result = await donationCampaigns.updateOne(filter, updateDoc);
      res.send(result);
    });

    /* -----------------payment related--------------- */
    //create payment intent
    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const { donationAmount } = req.body;

      if (!donationAmount) {
        return res.status(400).send({ message: "Donation amount not found!" });
      }
      const donateAmount = donationAmount * 100;
      const { client_secret } = await stripe.paymentIntents.create({
        amount: donateAmount,
        currency: "usd",
        automatic_payment_methods: {
          enabled: true,
        },
      });
      res.send({ clientSecret: client_secret });
    });

    /* ------------------- Overview Stats ------------------------- */
    app.get("/overview-stats/:email", async (req, res) => {
      const email = req.params.email;
      const totalPets = await petsCollection.countDocuments({
        "petOwner.email": email,
      });
      const myDonationCampaigns = await donationCampaigns.countDocuments({
        "askerInfo.email": email,
      });
      const myAdoptionRequests = await adoptionRequests.countDocuments({
        petOwnerInfo: email,
      });
      const totalDonations = await donations.aggregate([
          { $match: { "donator.email": email } },
          { $group: { _id: null, totalAmount: { $sum: "$donationAmount" } } },
        ])
        .toArray();

      res.send({
        totalPets,
        myDonationCampaigns,
        myAdoptionRequests,
        totalDonations:
          totalDonations.length > 0 ? totalDonations[0].totalAmount : 0,
      });
    });

    /* ------------------------------------------------ */
    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from paw-hope Server..");
});

app.listen(port, () => {
  console.log(`paw-hope is running on port ${port}`);
});
