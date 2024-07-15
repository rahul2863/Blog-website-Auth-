import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import pg from "pg";
import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy } from "passport-local";
import session from "express-session";
import GoogleStrategy from "passport-google-oauth2";
import env from "dotenv";

const app = express();
const port = 3000;
const API_URL = "http://localhost:4000";
const saltRounds = 10;
env.config();
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
  })
);

app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(passport.initialize());
app.use(passport.session());


const db = new pg.Client({
  user:  process.env.DB_USER,
  host:  process.env.DB_HOST,
  database: process.env.DB_NAME,
  password:  process.env.DB_PASSWORD,
  port:  process.env.PORT || 5432,
});

db.connect();


// Route to render the main page
app.get("/", async (req, res) => {
  if (req.isAuthenticated()) {
    try {
      const response = await axios.get(`${API_URL}/posts?id=${req.user.id}`);
      console.log(response);
      res.render("index.ejs", { posts: response.data });
    } catch (error) {
      res.status(500).json({ message: "Error fetching posts" });
    }
  } else {
    res.redirect("/home");
  }
});

//Route to render home page
app.get("/home", (req, res) => {
  res.render("home.ejs");
});

//get login
app.get('/login',(req,res)=>{
  res.render("login.ejs");
});

//get logout
app.get("/logout", (req, res) => {
  req.logout(function (err) {
    if (err) console.log(err);
    res.redirect("/");
  });
});

//get register
app.get("/register", (req, res) => {
  res.render("register.ejs");
});

// Route to render the edit page
app.get("/new", (req, res) => {
  res.render("modify.ejs", { heading: "New Post", submit: "Create Post" });
});

app.get("/edit/:id", async (req, res) => {
  try {
    const response = await axios.get(`${API_URL}/posts/${req.params.id}`);
    console.log("Editing Post:",response.data);
    res.render("modify.ejs", {
      heading: "Edit Post",
      submit: "Update Post",
      post: response.data,
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching post" });
  }
});

app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/",
    failureRedirect: "/login",
  })
);

// Create a new post
app.post("/api/posts", async (req, res) => {
  console.log(req.user)
  const data={
    id: req.user.id,
    title: req.body.title,
    content: req.body.content,
    author: req.body.author,
  };
  console.log(data)
  try {
    const response = await axios.post(`${API_URL}/posts`,data);
    console.log(response.data);
    res.redirect("/");
  } catch (error) {
    res.status(500).json({ message: "Error creating post" });
  }
});

// Partially update a post
app.post("/api/posts/:id", async (req, res) => {
  console.log("called");
  try {
    const response = await axios.patch(
      `${API_URL}/posts/${req.params.id}`,
      req.body
    );
    console.log(response.data);
    res.redirect("/");
  } catch (error) {
    res.status(500).json({ message: "Error updating post" });
  }
});

// Delete a post
app.get("/api/posts/delete/:id", async (req, res) => {

  console.log(req.params.id);
  try {
    await axios.delete(`${API_URL}/posts/${req.params.id}`);
    res.redirect("/");
  } catch (error) {
    res.status(500).json({ message: "Error deleting post" });
  }
});

//Scope specifies what are we going to use if we successfully authenticate
app.get("/auth/google",passport.authenticate("google", {
  scope: ["profile", "email"],
})
);

app.get("/auth/google/secrets",passport.authenticate("google",{
successRedirect : "/",
failureRedirect: "/login",
}));


//post register
app.post("/register", async (req, res) => {
  const email = req.body.username;
  const password = req.body.password;

  try {
    const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    if (checkResult.rows.length > 0) {
      res.redirect("/login");
    } else {
      bcrypt.hash(password, saltRounds, async (err, hash) => {
        if (err) {
          console.error("Error hashing password:", err);
        } else {
          const result = await db.query(
            "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING *",
            [email, hash]
          );
          const user = result.rows[0];
          req.login(user, (err) => {
            console.log("success");
            res.redirect("/");
          });
        }
      });
    }
  } catch (err) {
    console.log(err);
  }
});

//Local Strategy implementation
passport.use(
  new Strategy(async function verify(username, password, cb) {
    try {
      const result = await db.query("SELECT * FROM users WHERE email = $1 ", [
        username,
      ]);
      if (result.rows.length > 0) {
        const user = result.rows[0];
        const storedHashedPassword = user.password;
        bcrypt.compare(password, storedHashedPassword, (err, valid) => {
          if (err) {
            //Error with password check
            console.error("Error comparing passwords:", err);
            return cb(err);
          } else {
            if (valid) {
              //Passed password check
              return cb(null, user);
            } else {
              //Did not pass password check
              return cb(null, false);
            }
          }
        });
      } else {
        return cb("User not found");
      }
    } catch (err) {
      console.log(err);
    }
  })
);

//Google Strategy
passport.use("google", new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: "http://localhost:3000/auth/google/secrets",
  userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
},
async (accessToken, refreshToken, profile, cb)=>{
  console.log("Profile: ",profile);
  try{
    const result = await db.query("SELECT * FROM users WHERE email= $1",[profile.email]);
    //If no user with the provided email
    if(result.rows.length == 0){
      //when signed up using google strategy u don't have enter password but developer sets the 
      //password as "google" or anything of his/her choice to identify that user 
      //did signed up using google startegy
      const newUser = await db.query("INSERT INTO users (email,password) VALUES($1,$2)",
        [profile.email,"google"]);

      cb(null,newUser.rows[0]);
    }
    else{
      //Already Existing User
      cb(null,result.rows[0]);
    }
  }catch (err) {
    cb(err);
  }
}

));

passport.serializeUser((user, cb) => {
  cb(null, user);
});

passport.deserializeUser((user, cb) => {
  cb(null, user);
});

app.listen(port, () => {
  console.log(`Backend server is running on http://localhost:${port}`);
});
