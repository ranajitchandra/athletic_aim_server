require('dotenv').config()
const express = require('express')
const cors = require('cors')

const jwt = require('jsonwebtoken')
const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const admin = require('firebase-admin')

const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);

const app = express()
const port = process.env.PORT || 3000

// middleware
app.use(
    cors({
        origin: ['http://localhost:5173', 'https://athletic-aim.web.app'], // where come  from data, set fronend root use
        credentials: true, // allow cookie from fronend side
    }),
)
app.use(express.json())
app.use(cookieParser())

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString(
    'utf8',
)
const serviceAccount = JSON.parse(decoded)

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
})

// const logger = (req, res, next) => {
// 	console.log('inside the logger middleware')
// 	next()
// }


const verifyTokenOfJWT = (req, res, next) => {
    const token = req.cookies.Token
    console.log('cookie in the middleware jwt---', req.cookies.Token)
    if (!token) {
        return res.status(401).send({ message: 'unauthorize access' })
    }
    // verify token
    jwt.verify(token, process.env.JWT_ACCESS_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({ message: 'unauthorize access' })
        }
        req.decoded = decoded
        next()
    })
}



// const verifyFireBaseToken = async (req, res, next) => {
// 	const authHeader = req.headers?.authorization

// 	if (!authHeader || !authHeader.startsWith('Bearer ')) {
// 		return res.status(401).send({ message: 'unauthorized access' })
// 	}

// 	const token = authHeader.split(' ')[1]

// 	try {
// 		const decoded = await admin.auth().verifyIdToken(token)
// 		req.decoded = decoded
// 		next()
// 	} catch (error) {
// 		return res.status(401).send({ message: 'unauthorized access' })
// 	}
// }

const verifyTokenEmail = (req, res, next) => {
    const email = req.query.email
    if (email !== req.decoded.email) {
        return res.status(403).send({ message: 'forbidden access' })
    }
    next()
}
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.spiztbi.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
})

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();

        const users = client.db('athleticAimDB').collection('users')
        const eventsCollecttion = client.db('athleticAimDB').collection('events')
        const eventBooking = client.db('athleticAimDB').collection('eventBooking')
        const subscribers = client.db('athleticAimDB').collection('subscribers')


        // jwt token related api

        app.post('/jwt', (req, res) => {
            const { email } = req.body
            const user = { email }
            // genarate secret data with require('crypto').randomBytes(64).toString('hex')
            const token = jwt.sign(user, process.env.JWT_ACCESS_SECRET, {
                expiresIn: '1h',
            })
            // set token in the cookie 

            // res.cookie('Token', token, {
            // 	httpOnly: true,
            // 	secure: false,
            // })
            res.cookie('Token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',

            })
            res.send({ token })
        })






        //  Create User
        app.post('/users', async (req, res) => {
            const email = req.body.email;
            const userExists = await users.findOne({ email })
            if (userExists) {
                // update last log in
                return res.status(200).send({ message: 'User already exists', inserted: false });
            }
            const user = req.body;
            const result = await users.insertOne(user);
            res.send(result);
        })


        app.get('/users/:email/role', async (req, res) => {
            try {
                const email = req.params.email;

                if (!email) {
                    return res.status(400).send({ message: 'Email is required' });
                }

                const user = await users.findOne({ email });

                if (!user) {
                    return res.status(404).send({ message: 'User not found' });
                }

                res.send({ role: user.role || 'user' });
            } catch (error) {
                console.error('Error getting user role:', error);
                res.status(500).send({ message: 'Failed to get role' });
            }
        });

        // Search users by name or email
        app.get("/users", async (req, res) => {
            const search = req.query.search || "";
            const query = {
                $or: [
                    { name: { $regex: search, $options: "i" } },
                    { email: { $regex: search, $options: "i" } },
                ],
            };
            const result = await users.find(query).toArray();
            res.send(result);
        });


        // Update user role
        // app.patch("/users/:id", async (req, res) => {
        //     const { id } = req.params;
        //     const { role } = req.body;
        //     const result = await users.updateOne(
        //         { _id: new ObjectId(id) },
        //         { $set: { role } }
        //     );
        //     res.send(result);
        // });



        app.patch('/users/:id', async (req, res) => {
            const { id } = req.params;
            const updates = { ...req.body };

            try {
                // Prevent email from being updated no matter what
                if ('email' in updates) delete updates.email;

                // Separate role from other fields
                const role = updates.role;
                if ('role' in updates) delete updates.role;

                // Prepare the update document
                const updateDoc = {};
                if (Object.keys(updates).length > 0) {
                    updateDoc.$set = updates;
                }
                if (role !== undefined) {
                    updateDoc.$set = {
                        ...updateDoc.$set,
                        role: role,
                    };
                }

                if (Object.keys(updateDoc).length === 0) {
                    return res.status(400).send({ message: 'No valid fields provided to update' });
                }

                const result = await users.updateOne(
                    { _id: new ObjectId(id) },
                    updateDoc
                );

                if (result.matchedCount === 0) {
                    return res.status(404).send({ message: 'User not found' });
                }

                res.send({ message: 'User updated', modifiedCount: result.modifiedCount });
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: 'Failed to update user' });
            }
        });






        app.post('/addEvent', async (req, res) => {
            const newEvent = req.body
            newEvent.date = new Date(newEvent.date);
            newEvent.price = parseInt(newEvent.price, 10);
            console.log(newEvent);

            const result = await eventsCollecttion.insertOne(newEvent)
            res.send(result)
        })



        // // -------------------------------------
        app.get('/events', verifyTokenOfJWT, async (req, res) => {
            const { email, name } = req.query
            console.log("--------", name);


            const query = {}
            if (email) {
                query.creatorEmail = email

                if (email !== req.decoded.email) {
                    return res.status(403).send({ message: 'forbidden access' })
                }
            }
            // search
            if (name) {
                query.name = { $regex: name, $options: 'i' };
            }
            const result = await eventsCollecttion.find(query).toArray()
            res.send(result)
        })


        // GET nearest upcoming event
        app.get("/events/upcoming", async (req, res) => {
            try {
                const now = new Date();

                const event = await eventsCollecttion
                    .find({ date: { $gte: now } }) // compare with Date object
                    .sort({ date: 1 }) // nearest first
                    .limit(1)
                    .toArray();

                if (!event || event.length === 0) {
                    return res.status(404).json({ message: "No upcoming events" });
                }

                res.json(event[0]);
            } catch (error) {
                console.error("Error fetching upcoming event:", error);
                res.status(500).json({ message: "Server error" });
            }
        });


        app.get('/events/:id', async (req, res) => {
            const id = req.params.id
            const query = { _id: new ObjectId(id) }
            const result = await eventsCollecttion.findOne(query)
            res.send(result)
        })

        app.delete('/events/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await eventsCollecttion.deleteOne(query);
            res.send(result);
        })
        app.put('/events/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const options = { upsert: true };
            const updatedEvent = req.body;
            const updatedDoc = {
                $set: updatedEvent
            }

            // const updatedDoc = {
            //     $set: {
            //         name: updatedEvent.name, 
            //         supplier: updatedEvent.supplier
            //     }
            // }

            const result = await eventsCollecttion.updateOne(filter, updatedDoc, options);

            res.send(result);
        })








        app.post('/eventBooking', async (req, res) => {
            const eventData = req.body
            console.log(eventData)

            const result = await eventBooking.insertOne(eventData)
            res.send(result)
        })
        app.get('/eventBooking/:id', async (req, res) => {
            const id = req.params.id;
            console.log(id);

            const query = { eventID: id };
            const result = await eventBooking.findOne(query);
            res.send(result);
        });


        app.get(
            '/bookedEvent',
            verifyTokenOfJWT,
            verifyTokenEmail,
            async (req, res) => {
                console.log(req);

                const email = req.query.email

                const query = {
                    bookedUser: email,
                }
                const result = await eventBooking.find(query).toArray()

                // bad way aggrigate
                for (const booking of result) {
                    const eventID = booking.eventId
                    const eventQuery = { _id: new ObjectId(eventID) }
                    const event = await eventsCollecttion.findOne(eventQuery)

                    booking.name = event.name
                    booking.type = event.type
                    booking.date = event.date
                    booking.creatorEmail = event.creatorEmail
                    booking.contactNumber = event.contactNumber
                    booking.pictureUrl = event.pictureUrl
                    booking.price = event.price
                }

                res.send(result)
            },
        )



        app.post("/newsletter/subscribe", async (req, res) => {
            const { email } = req.body;
            if (!email || !email.includes("@")) {
                return res.status(400).json({ message: "Valid email required" });
            }

            const existing = await subscribers.findOne({ email });
            if (existing) {
                return res.status(409).json({ message: "Email already subscribed" });
            }

            const result = await subscribers.insertOne({ email, subscribedAt: new Date() });
            res.status(201).json({ message: "Subscribed successfully" });
        });



        app.post('/create-payment-intent', async (req, res) => {
            const amountInCents = req.body.amountInCents
            try {
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amountInCents, // Amount in cents
                    currency: 'usd',
                    payment_method_types: ['card'],
                });

                res.json({ clientSecret: paymentIntent.client_secret });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });










        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir)

app.get('/', (req, res) => {
    res.send('Athletic Aim Server root path')
})

app.listen(port, () => {
    console.log(`Athletic aim server is running on port: ${port}`)
})
