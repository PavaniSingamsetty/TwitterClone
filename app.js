const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

let db = null;

const dbPath = path.join(__dirname, "twitterClone.db");

const initializeDbServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    app.listen(3000, () => {
      console.log("Server is running at http://localhost:3000/");
    });
  } catch (error) {
    console.log(`Database error: ${error.message}`);
    process.exit(1);
  }
};

initializeDbServer();

// Register User API
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  console.log(hashedPassword);
  const getUserRequest = `
        SELECT username
        FROM user
        where username = '${username}'
    `;

  const userDetails = await db.get(getUserRequest);

  if (userDetails === undefined) {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const addUserRequest = `
        INSERT INTO 
            user(username, password, name, gender)
        VALUES 
            ('${username}', '${hashedPassword}', '${name}', '${gender}')
      `;

      await db.run(addUserRequest);
      response.status(200);
      response.send("User created successfully");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

//Login User API
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const getUserRequest = `
        SELECT *
        FROM user
        WHERE username = '${username}'
    `;

  const userDetails = await db.get(getUserRequest);

  if (userDetails === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const passwordVerification = await bcrypt.compare(
      password,
      userDetails.password
    );

    if (passwordVerification) {
      const payload = { userId: userDetails.user_id };

      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.status(200);
      response.send({ jwtToken: `${jwtToken}` });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

const Authentication = async (request, response, next) => {
  const authHeader = request.headers["authorization"];
  let jwtToken;
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken !== undefined) {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.userId = payload.userId;
        next();
      }
    });
  } else {
    response.status(401);
    response.send("Invalid JWT Token");
  }
};

// Get latest tweets of people whom the user follows
app.get("/user/tweets/feed/", Authentication, async (request, response) => {
  const { userId } = request;
  const getFollowersUserId = `
    SELECT DISTINCT following_user_id AS id
    FROM follower
    WHERE follower_user_id = ${userId}
  `;

  const followersList = await db.all(getFollowersUserId);

  const followersIdList = followersList.map((follower) => follower.id);

  const getTweetsRequest = `
    SELECT username, tweet, date_time AS dateTime 
    FROM tweet INNER JOIN user 
    ON tweet.user_id=user.user_id
    WHERE tweet.user_id IN (${followersIdList.join(",")})
    ORDER BY date_time DESC
    LIMIT 4 OFFSET 0
  `;

  const tweetsList = await db.all(getTweetsRequest);
  response.send(tweetsList);
});

// Get list of all names of people whom the user follows
app.get("/user/following/", Authentication, async (request, response) => {
  const { userId } = request;
  const getFollowingUserId = `
    SELECT DISTINCT following_user_id AS id
    FROM follower
    WHERE follower_user_id = ${userId}
  `;

  const followingList = await db.all(getFollowingUserId);

  const followingIdList = followingList.map((follower) => follower.id);

  const getFollowingName = `
    SELECT name
    FROM user
    WHERE user_id IN (${followingIdList.join(",")})
  `;
  const following = await db.all(getFollowingName);
  response.send(following);
});

// Get list of all names of people whom the user follows
app.get("/user/followers/", Authentication, async (request, response) => {
  const { userId } = request;
  const getFollowersUserId = `
    SELECT DISTINCT follower_user_id AS id
    FROM follower
    WHERE following_user_id = ${userId}
  `;

  const followersList = await db.all(getFollowersUserId);

  const followersIdList = followersList.map((follower) => follower.id);

  const getFollowersName = `
    SELECT name
    FROM user
    WHERE user_id IN (${followersIdList.join(",")})
  `;
  const followers = await db.all(getFollowersName);
  response.send(followers);
});

// Get tweet details of people whom the user follows
app.get("/tweets/:tweetId/", Authentication, async (request, response) => {
  const { tweetId } = request.params;
  const { userId } = request;
  const getFollowingUserId = `
    SELECT DISTINCT following_user_id AS id
    FROM follower
    WHERE follower_user_id = ${userId}
  `;

  const followingList = await db.all(getFollowingUserId);

  const followingIdList = followingList.map((follower) => follower.id);

  const getTweet = `
    SELECT tweet, 
    (
        SELECT COUNT(like_id) 
        FROM tweet LEFT JOIN like
        ON tweet.tweet_id = like.tweet_id
        WHERE tweet.tweet_id = ${tweetId}
        GROUP BY like.tweet_id
    ) AS likes,
    (
        SELECT COUNT(reply_id) 
        FROM tweet LEFT JOIN reply
        ON tweet.tweet_id = reply.tweet_id
        WHERE tweet.tweet_id = ${tweetId}
        GROUP BY reply.tweet_id
    ) AS replies, tweet.date_time AS dateTime
    FROM tweet
    WHERE user_id IN (${followingIdList.join(",")}) AND tweet_id = ${tweetId}
  `;
  const tweetDetails = await db.get(getTweet);
  if (tweetDetails !== undefined) {
    response.send(tweetDetails);
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

// Get list of usernames people who liked the tweet of person who user follows
app.get("/tweets/:tweetId/likes", Authentication, async (request, response) => {
  const { tweetId } = request.params;
  const { userId } = request;
  const getFollowingUserId = `
    SELECT DISTINCT following_user_id AS id
    FROM follower
    WHERE follower_user_id = ${userId}
  `;

  const followingList = await db.all(getFollowingUserId);

  const followingIdList = followingList.map((follower) => follower.id);

  const getTweetLikes = `
    SELECT username
    FROM like INNER JOIN tweet ON like.tweet_id = tweet.tweet_id
    INNER JOIN user ON user.user_id = like.user_id
    WHERE tweet.user_id IN (${followingIdList.join(
      ","
    )}) AND like.tweet_id = ${tweetId}
  `;
  const tweetLikedDetails = await db.all(getTweetLikes);

  if (tweetLikedDetails.length !== 0) {
    const likedUsernamesList = tweetLikedDetails.map((user) => user.username);
    response.send({ likes: likedUsernamesList });
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

// Get list of people who replied the tweet of person who user follows
app.get(
  "/tweets/:tweetId/replies",
  Authentication,
  async (request, response) => {
    const { tweetId } = request.params;
    const { userId } = request;
    const getFollowingUserId = `
    SELECT DISTINCT following_user_id AS id
    FROM follower
    WHERE follower_user_id = ${userId}
  `;

    const followingList = await db.all(getFollowingUserId);

    const followingIdList = followingList.map((follower) => follower.id);

    const getTweetReplies = `
    SELECT name, reply
    FROM reply INNER JOIN tweet ON reply.tweet_id = tweet.tweet_id
    INNER JOIN user ON user.user_id = reply.user_id
    WHERE tweet.user_id IN (${followingIdList.join(
      ","
    )}) AND reply.tweet_id = ${tweetId}
  `;
    const tweetRepliedDetails = await db.all(getTweetReplies);

    if (tweetRepliedDetails.length !== 0) {
      const repliedUsersList = tweetRepliedDetails.map((user) => ({
        name: user.name,
        reply: user.reply,
      }));
      response.send({ replies: repliedUsersList });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

// Get tweet details of user
app.get("/user/tweets/", Authentication, async (request, response) => {
  const { userId } = request;

  const getTweetsIdRequest = `
    SELECT tweet_id AS id
    FROM tweet
    WHERE user_id = ${userId}
  `;

  const tweetsIdList = await db.all(getTweetsIdRequest);

  const tweetDetailsList = [];
  for (let tweet of tweetsIdList) {
    const tweetId = tweet.id;
    const getTweet = `
        SELECT tweet, 
        (
            SELECT COUNT(like_id) 
            FROM tweet LEFT JOIN like
            ON tweet.tweet_id = like.tweet_id
            WHERE tweet.tweet_id = ${tweetId}
            GROUP BY like.tweet_id
        ) AS likes,
        (
            SELECT COUNT(reply_id) 
            FROM tweet LEFT JOIN reply
            ON tweet.tweet_id = reply.tweet_id
            WHERE tweet.tweet_id = ${tweetId}
            GROUP BY reply.tweet_id
        ) AS replies, tweet.date_time AS dateTime
        FROM tweet
        WHERE user_id = ${userId} AND tweet_id = ${tweetId}
    `;
    const tweetDetails = await db.get(getTweet);

    tweetDetailsList.push(tweetDetails);
  }

  response.send(tweetDetailsList);
});

//Post tweet by user
app.post("/user/tweets/", Authentication, async (request, response) => {
  const { userId } = request;
  const { tweet } = request.body;
  const dateTime = new Date();

  const postTweetQuery = `
        INSERT INTO 
            tweet (tweet, user_id, date_time)
        VALUES
        ('${tweet}', ${userId}, '${dateTime}')
    `;

  await db.run(postTweetQuery);
  response.send("Created a Tweet");
});

//Delete tweet of user
app.delete("/tweets/:tweetId", Authentication, async (request, response) => {
  const { userId } = request;
  const { tweetId } = request.params;

  const getTweetsIdRequest = `
    SELECT tweet_id AS id
    FROM tweet
    WHERE user_id = ${userId}
  `;

  const tweetsIdList = await db.all(getTweetsIdRequest);
  const tweetIds = tweetsIdList.map((tweet) => tweet.id);
  console.log(typeof tweetId);
  console.log(tweetIds.includes(tweetId));

  if (tweetIds.includes(parseInt(tweetId))) {
    const deleteTweetQuery = `
        DELETE FROM tweet
        WHERE tweet_id= ${tweetId} and user_id = ${userId}
    `;

    await db.run(deleteTweetQuery);
    response.send("Tweet Removed");
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

module.exports = app;
