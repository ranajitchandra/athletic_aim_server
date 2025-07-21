require('dotenv').config()
const express = require('express')
const cors = require('cors')

const jwt = require('jsonwebtoken')
const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const admin = require('firebase-admin')

const app = express()
const port = process.env.PORT || 3000

// middleware
app.use(
    cors({
        origin: ['http://localhost:5173'], // where come  from data, set fronend root use
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
        await client.connect();

        const eventsCollecttion = client.db('athleticAimDB').collection('events')
        const eventBooking = client.db('athleticAimDB').collection('eventBooking')


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

        app.post('/addEvent', async (req, res) => {
            const newEvent = req.body
            console.log(newEvent)
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
                    const eventID = booking.eventID
                    const eventQuery = { _id: new ObjectId(eventID) }
                    const event = await eventsCollecttion.findOne(eventQuery)

                    booking.name = event.name
                    booking.type = event.type
                    booking.date = event.date
                    booking.creatorEmail = event.creatorEmail
                    booking.contactNumber = event.contactNumber
                    booking.pictureUrl = event.pictureUrl
                }

                res.send(result)
            },
        )

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
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
