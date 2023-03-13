import cors from 'cors';
import express, { Express, Request, Response } from 'express';
import serverless from 'serverless-http';
import AWS from 'aws-sdk';
import bodyParser from 'body-parser'
import {Reclaim, generateUuid} from 'template-client-sdk'

const app: Express = express();

app.use(cors())
app.use(bodyParser.json())

const USERS_TABLE = process.env.USERS_TABLE;
const callbackUrl = process.env.CALLBACK_URL;

const dynamoDb = new AWS.DynamoDB;

const reclaim = new Reclaim(callbackUrl)
const connection = reclaim.getConsent(
  'YC',
  [
    {
      provider: 'yc-login',
      params: { }
    }
  ]
)

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

  const params: AWS.DynamoDB.GetItemInput = {
    TableName: USERS_TABLE!,
    Key: {
      userId: {S: userId},
    },
  };

  dynamoDb.getItem(params, (error, result) => {
    if (error) {
      res.status(400).json({ error: 'Could not get user' });
      return
    }
    if (result.Item) {
      const { userId, userAddress, templateLink, callbackId } = result.Item;
      res.json({ userId, userAddress, templateLink, callbackId });
      return
    } else {
      res.status(404).json({ error: "User not found" });
      return
    }
  });
})

app.post("/adduser/", async(req: Request<{}, {}, {userId: string, userAddress: string}>, res: Response, next) => {
  const { userId, userAddress } = req.body;
  if (typeof userId !== 'string') {
    res.status(400).json({ error: '"userId" must be a string' });
    return
  } else if (typeof userAddress !== 'string') {
    res.status(400).json({ error: '"userAddress" must be a string' });
    return
  }

  const callbackId = `${userId}-${generateUuid()}`;

  const template = (await connection).generateTemplate(callbackId);
  const templateUrl = template.url

  const params: AWS.DynamoDB.PutItemInput = {
    TableName: USERS_TABLE!,
    ConditionExpression: "attribute_not_exists(userId)",
    Item: {
      userId: {S: userId},
      userAddress: {S: userAddress},
      templateLink: {S: templateUrl},
      callbackId: {S: callbackId},
      status: {S: "pending"}
    },
  };

  dynamoDb.putItem(params, (error) => {
    if (error) {
      res.status(400).json({ error:  `Could not create user ${error}` });
      return
    }
    res.json({ userId, templateUrl });
    return
  });
})

app.post("/callback/:id", (req: Request<{}, {}, {userId: string, claim: string}>, res: Response, next) => {

  // TODO: verify the correctness of the proof

  // TODO: update claim for user if callbackId exists
})

app.get('/status/:callbackId', (req: Request, res: Response, next) => {
  const callbackId = req.params.callbackId;

  const params: AWS.DynamoDB.QueryInput = {
    TableName: USERS_TABLE!,
    IndexName: "callbackId-index",
    ExpressionAttributeValues: {
      ":v_callbackId": {
        S: callbackId
       }
     }, 
    KeyConditionExpression: "callbackId = :v_callbackId",
    ProjectionExpression: "status",
  };

  dynamoDb.query(params, (error, result) => {
    if (error) {
      res.status(400).json({ error: `Could not get status for callback id ${callbackId}` });
      return
    }
    if (result.Items) {
      const { status } = result.Items[0];
      res.json({ status });
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
