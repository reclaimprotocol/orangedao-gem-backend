import cors from 'cors';
import express, { Express, Request, Response } from 'express';
import serverless from 'serverless-http';
import AWS from 'aws-sdk';
import bodyParser from 'body-parser'
import { Reclaim } from '@reclaimprotocol/reclaim-sdk'
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

  const claimsBody = req.body
  const { userAddress } = req.params

  const claims = JSON.parse(decodeURIComponent(claimsBody)).claims

  const paramKey = Object.keys(claims[0].parameters)[0]
  logger.info(`[INFO] parameters: ${claims[0].parameters}`)
  logger.info(`[INFO] paramKey: ${paramKey}`)
  const userId = claims[0].parameters[paramKey]

  logger.info(`[INFO] ${userAddress} is claiming ${userId}`)

  const stringifiedClaim = JSON.stringify(claims[0])

  const scanParams: AWS.DynamoDB.ScanInput = {
    TableName: USERS_TABLE!,
    ExpressionAttributeValues: {
      ":v_userId": {
        S: userId
      }
    },
    ConsistentRead: true,
    FilterExpression: "userId= :v_userId",
    ProjectionExpression: "claimStatus",
  };

  const updateParams: AWS.DynamoDB.UpdateItemInput = {
    TableName: USERS_TABLE!,
    ConditionExpression: "attribute_not_exists(userId) AND userAddress = :v_userAddress",
    Key: {
      userAddress: { S: userAddress }
    },
    UpdateExpression: "SET userId=if_not_exists(userId,:u), claimString=:c, claimStatus=:s, claimUpdatedAt=:t",
    ExpressionAttributeValues: {
      ":v_userAddress": {
        S: userAddress
      },
      ":u": {
        S: userId
      },
      ":c": {
        S: stringifiedClaim
      },
      ":s":{
        S: status.CLAIMED
      },
      ":t": {
        S: new Date().toISOString()
      }
    },
  };

  dynamoDb.scan(scanParams, (error, result) => {
    if (error) {
      logger.info(`[ERROR] Scanning for ${userId} failed with error ${error}`)
      res.render('pages/fail', {message: "Scanning for user id failed"})
      return
    } else if (result.Items.length) {
      logger.warn(`[WARN] ${userId} already claimed`)
      res.render('pages/fail', {message: "This user id has already claimed the orange gem"})
      return

    } else {
      dynamoDb.updateItem(updateParams, (error) => {
        if (error) {
          logger.error(`[ERROR] Could not update claim for ${userId} with error ${error}`)
          res.render('pages/fail', {message: "Could not update claim"})
          return
        }
        logger.info(`Claim for ${userId} updated`)
        const redirectUrl = `${redirectBaseUrl}?callbackId=${userAddress}`
        res.render('pages/success', {userAddress})
        return
      })
    }
  })
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
