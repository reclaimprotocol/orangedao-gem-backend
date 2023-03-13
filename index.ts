import cors from 'cors';
import express, { Express, Request, Response } from 'express';
import serverless from 'serverless-http';
import AWS from 'aws-sdk';
import bodyParser from 'body-parser'

const app: Express = express();

app.use(cors())
app.use(bodyParser.json())

const USERS_TABLE = process.env.USERS_TABLE;

const dynamoDb = new AWS.DynamoDB.DocumentClient();

app.get("/", (req, res, next) => {
  return res.status(200).json({
    message: "Hello from root!",
  });
});

app.get("/user/:userId", (req: Request, res: Response, next) => {
  const { userId } = req.params;
  if (typeof userId !== 'string') {
    res.status(400).json({ error: '"userId" must be a string' });
    return
  }

  const params = {
    TableName: USERS_TABLE!,
    Key: {
      userId: userId,
    },
  };

  dynamoDb.get(params, (error, result) => {
    if (error) {
      res.status(400).json({ error: 'Could not get user' });
      return
    }
    if (result.Item) {
      const { id, userAddress, templateLink, callbackId } = result.Item;
      res.json({ id, userAddress, templateLink, callbackId });
      return
    } else {
      res.status(404).json({ error: "User not found" });
      return
    }
  });
})

app.post("/adduser/", (req: Request<{}, {}, {userId: string, userAddress: string}>, res: Response, next) => {
  const { userId, userAddress } = req.body;
  if (typeof userId !== 'string') {
    res.status(400).json({ error: '"userId" must be a string' });
    return
  } else if (typeof userAddress !== 'string') {
    res.status(400).json({ error: '"userAddress" must be a string' });
    return
  }

  // TODO: generate callbackId

  // TODO: create template link for user
 
  const params = {
    TableName: USERS_TABLE!,
    Item: {
      userId: userId,
      userAddress: userAddress,
      templateLink: "templateLink",
      callbackId: "callbackId",
      status: "pending"
    },
  };

  dynamoDb.put(params, (error) => {
    if (error) {
      res.status(400).json({ error: 'Could not create user' });
      return
    }
    res.json({ message: `${userId} added` });
    return
  });
})

app.post("/callback/:id", (req: Request<{}, {}, {userId: string, claim: string}>, res: Response, next) => {
  // TODO: check for callbackId

  // TODO: verify the correctness of the proof

  // TODO: update claim for user
})

app.get('/status/:callbackId', (req: Request, res: Response, next) => {
  const callbackId = req.params.callbackId;

  const params = {
    TableName: USERS_TABLE!,
    Key: {
      callbackId: callbackId,
    },
  };

  dynamoDb.get(params, (error, result) => {
    if (error) {
      res.status(400).json({ error: `Could not get status for callback id ${callbackId}` });
      return
    }
    if (result.Item) {
      const { status } = result.Item;
      res.json({ callbackId, status });
      return
    } else {
      res.status(404).json({ error: `callbackId ${callbackId} not found` });
      return
    }
  })

})

app.use((req, res, next) => {
  return res.status(404).json({
    error: "Not Found",
  });
});

export const handler = serverless(app);
