const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const app = express();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.0bupn.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

// console.log(uri);

function verifyJWT(req, res, next) {
  const authorization = req.headers.authorization;
  // console.log("auth header", authorization);
  if (!authorization) {
    return res.status(401).send({ message: "Invalid authorization" });
  }
  const token = authorization.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
    if (err) {
      console.log(err);
      return res.status(403).send({ message: "forbidden" });
    }
    req.decoded = decoded;
    next();
  });
}

const run = async () => {
  try {
    await client.connect();

    const serverCollation = client.db("doctors_portal").collection("services");
    const bookingCollation = client.db("doctors_portal").collection("booking");
    const userCollation = client.db("doctors_portal").collection("user");
    const doctorCollation = client.db("doctors_portal").collection("doctors");
    const paymentCollation = client.db("doctors_portal").collection("payments");

    const verifyAdmin = async (req, res, next) => {
      const requester = req.decoded.email;
      const requesterAccount = await userCollation.findOne({
        email: requester,
      });
      if (requesterAccount.role === "admin") {
        next();
      } else {
        res.status(403).send({ message: "forbidden" });
      }
    };

    app.get("/booking/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const booking = await bookingCollation.findOne(query);
      res.send(booking);
    });

    app.get("/service", async (req, res) => {
      const query = {};
      const cursor = serverCollation.find(query).project({ name: 1 });
      const services = await cursor.toArray();
      res.send(services);
    });

    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const service = req.body;
      const price = service.price;
      const amount = price * 100;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({ clientSecret: paymentIntent.client_secret });
    });

    app.get("/user", verifyJWT, async (req, res) => {
      const users = await userCollation.find().toArray();
      res.send(users);
    });

    app.get("/admin/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollation.findOne({ email: email });
      const isAdmin = user.role === "admin";
      res.send({ admin: isAdmin });
    });

    // admin rule
    app.put("/user/admin/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const updateDoc = {
        $set: { role: "admin" },
      };
      const result = await userCollation.updateOne(filter, updateDoc);
      res.send(result);
    });

    app.put("/user/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };
      const options = { upsert: true };
      const updateDoc = {
        $set: user,
      };
      const result = await userCollation.updateOne(filter, updateDoc, options);
      const token = jwt.sign(
        { email: email },
        process.env.ACCESS_TOKEN_SECRET,
        {
          expiresIn: "10h",
        }
      );
      res.send({ result, token });
    });
    // wrong waw
    app.get("/available", async (req, res) => {
      const date = req.body.date || "May 14, 2022";
      // step 1  : get all services
      const services = await serverCollation.find().toArray();
      // step 2: get all booking of that day [{}, {}, {}, {}, {}, {}, {}, {},]
      const query = { date: date };
      const bookings = await bookingCollation.find(query).toArray();

      // step 3: for each service

      services.forEach((service) => {
        // step 4 find bookings for that service [{}, {}, {}, {}, {}, {},]
        const serviceBookings = bookings.filter(
          (book) => book.treatment === service.name
        );
        // step 5: select slots for the service Bookings : ['','', '', '']
        const bookedSlots = serviceBookings.map((book) => book.slot);
        // step 6: select those slots that are not in bookedSlots
        const available = service.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );
        // step 7 set available to slots to make it easier
        service.slots = available;
      });
      res.send(services);
    });

    /* 
    
    

    */
    /*
     * API Naming Convention
     * app.get('/booking') // get all booking in this collection. or get more then one or by filter
     * app.get('/booking/:id') // get specific booking
     * app.post('/booking') // add a new booking
     * app.patch('/booking/:id') // update a booking
     * app.delete('/booking/:id') // delete a booking
     */

    app.get("/booking", verifyJWT, async (req, res) => {
      const patient = req.query.patient;
      const decodedEmail = req.decoded.email;
      if (patient === decodedEmail) {
        const query = { patient: patient };
        const bookings = await bookingCollation.find(query).toArray();
        res.send(bookings);
      } else {
        return res.status(403).send({ message: "forbidden access" });
      }
    });

    app.post("/booking", async (req, res) => {
      const booking = req.body;
      const query = {
        treatment: booking.treatment,
        date: booking.date,
        patient: booking.patient,
      };
      const exists = await bookingCollation.findOne(query);
      if (exists) {
        console.log(exists);
        return res.send({ success: false, booking: exists });
      }
      const result = await bookingCollation.insertOne(booking);
      return res.send({ success: true, result });
    });

    app.patch("/booking/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const payment = req.body;
      const filter = { _id: ObjectId(id) };
      const updatedDoc = {
        $set: {
          paid: true,
          transactionId: payment.transactionId,
        },
      };
      const result = await paymentCollation.insertOne(payment);
      const updatedBooking = await bookingCollation.updateOne(
        filter,
        updatedDoc
      );
      res.send(updatedDoc);
    });
    /* app.patch("/booking/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const payment = req.body;
      const filter = { _id: ObjectId(id) };
      const updatedDoc = {
        $set: {
          paid: true,
          transactionId: payment.transactionId,
        },
      };

      const result = await paymentCollection.insertOne(payment);
      const updatedBooking = await bookingCollection.updateOne(
        filter,
        updatedDoc
      );
      res.send(updatedBooking);
    }); */

    app.get("/doctor", verifyJWT, verifyAdmin, async (req, res) => {
      const doctors = await doctorCollation.find().toArray();
      res.send(doctors);
    });

    app.post("/doctor", verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorCollation.insertOne(doctor);
      res.send(result);
    });

    app.delete("/doctor/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const result = await doctorCollation.deleteOne(filter);
      res.send(result);
    });
  } finally {
  }
};
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
