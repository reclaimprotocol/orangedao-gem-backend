import cors from 'cors';
import express, { Express, Request, Response } from 'express';
import serverless from 'serverless-http';
import AWS from 'aws-sdk';
import bodyParser from 'body-parser'
import { Reclaim } from '@reclaimprotocol/template-client-sdk'
import { Claim } from './utils/types';
import { status } from './utils/constants';
import P from 'pino'

const app: Express = express();

const logger = P()

app.use(cors())
app.use(bodyParser.json())

app.set('views', './views');
// set the view engine to ejs
app.set('view engine', 'ejs');

const USERS_TABLE = process.env.USERS_TABLE;
const callbackUrl = process.env.CALLBACK_URL;
const redirectBaseUrl = process.env.REDIRECT_BASE_URL;

const dynamoDb = new AWS.DynamoDB;

const reclaim = new Reclaim(callbackUrl)
const connection = reclaim.getConsent(
  'OrangeDAO-Gem',
  [
    {
      provider: 'yc-login',
      params: {}
    }
  ]
)

app.get("/", (req, res, next) => {
  res.status(200).json( {msg: "Orange DAO gem backend"})
  return
});

app.get("/user/:userAddress", (req: Request, res: Response, next) => {
  const { userAddress } = req.params;
  if (typeof userAddress !== 'string') {
    res.status(400).json({ error: '"userAddress" must be a string' });
    return
  }

  const params: AWS.DynamoDB.GetItemInput = {
    TableName: USERS_TABLE!,
    Key: {
      userAddress: { S: userAddress },
    },
  };

  dynamoDb.getItem(params, (error, result) => {
    if (error) {
      res.status(400).json({ error: 'Could not get user' });
      return
    }
    if (result.Item) {
      const { userAddress, templateLink, callbackId } = result.Item;
      res.json(result.Item);
      return
    } else {
      res.status(404).json({ error: "User not found" });
      return
    }
  });
})

app.post("/adduser/", async (req: Request<{}, {}, { userAddress: string }>, res: Response, next) => {
  const { userAddress } = req.body;
  if (typeof userAddress !== 'string') {
    res.status(400).json({ error: '"userAddress" must be a string' });
    return
  }

  const callbackId = `${userAddress}`;

  const template = (await connection).generateTemplate(callbackId);
  const templateUrl = template.url

  const params: AWS.DynamoDB.PutItemInput = {
    TableName: USERS_TABLE!,
    ConditionExpression: "attribute_not_exists(userAddress)",
    Item: {
      userAddress: { S: userAddress },
      templateLink: { S: templateUrl },
      callbackId: { S: callbackId },
      claimStatus: { S: status.PENDING },
      createdAtS: { S: new Date().toISOString() }
    },
  };

  dynamoDb.putItem(params, (error) => {
    if (error) {
      logger.error(`[ERROR] Could not create user ${error}`)
      res.status(400).json({ error: `Could not create user ${error}` });
      return
    }
    logger.info(`User ${userAddress} created`)
    res.json({ templateUrl });
    return
  });
})

app.post("/callback/:userAddress", (req: Request, res: Response, next) => {

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
    ProjectionExpression: "claimStatus",
  };

  dynamoDb.query(params, (error, result) => {
    if (error) {
      res.status(400).json({ error: `Could not get status for callback id ${callbackId}` });
      return
    }
    if (result.Items) {
      const { claimStatus } = result.Items[0];
      res.json({ claimStatus });
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
