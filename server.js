const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();

// =====================
// MONGODB CONNECT
// =====================
mongoose.connect("mongodb://127.0.0.1:27017/transfile")
.then(()=>console.log("MongoDB ulandi"))
.catch(err=>console.log(err));

// =====================
// MIDDLEWARE
// =====================
app.use(express.urlencoded({extended:true}));
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

app.use(session({
  secret:"transfile_secret",
  resave:false,
  saveUninitialized:false
}));

// =====================
// MULTER STORAGE
// =====================
if(!fs.existsSync("uploads")){
  fs.mkdirSync("uploads");
}

const storage = multer.diskStorage({
  destination:(req,file,cb)=>{
    cb(null,"uploads/");
  },
  filename:(req,file,cb)=>{
    cb(null,Date.now()+"-"+file.originalname);
  }
});

const upload = multer({storage});

// =====================
// MODELS
// =====================
const userSchema = new mongoose.Schema({
  username:String,
  password:String,
  role:{type:String,default:"user"},
  savedFiles:[{type:mongoose.Schema.Types.ObjectId,ref:"File"}]
});

const fileSchema = new mongoose.Schema({
  originalName:String,
  name:String,
  path:String,
  isFolder:{type:Boolean,default:false},
  parentFolder:{type:mongoose.Schema.Types.ObjectId,ref:"File",default:null},
  uploadedBy:{type:mongoose.Schema.Types.ObjectId,ref:"User"},
  views:{type:Number,default:0},
  createdAt:{type:Date,default:Date.now}
});

const User = mongoose.model("User",userSchema);
const File = mongoose.model("File",fileSchema);

// =====================
// AUTH CHECK
// =====================
function checkAuth(req,res,next){
  if(!req.session.user){
    return res.redirect("/login");
  }
  next();
}

// =====================
// LAYOUT
// =====================
function layout(title,content,req){
  return `
  <html>
  <head>
  <title>${title}</title>
  <style>
  body{font-family:Arial;background:#111;color:#fff;padding:20px}
  .card{background:#222;padding:15px;margin:10px 0;border-radius:8px}
  button{padding:5px 10px;border:none;border-radius:5px;cursor:pointer}
  a{color:cyan;text-decoration:none}
  </style>
  </head>
  <body>
  <h1>TRANS FILE</h1>
  ${
    req.session.user ?
    `
    👤 ${req.session.user.username} (${req.session.user.role})
    | <a href="/">Home</a>
    | <a href="/saved">Saqlanganlar</a>
    | <a href="/logout">Logout</a>
    <hr>
    `
    :
    `<a href="/login">Login</a>`
  }
  ${content}
  </body>
  </html>
  `;
}

// =====================
// REGISTER
// =====================
app.get("/register",(req,res)=>{
  res.send(layout("Register",`
  <form method="POST">
  <input name="username" placeholder="Username" required><br><br>
  <input name="password" type="password" placeholder="Password" required><br><br>
  <button>Register</button>
  </form>
  `,req));
});

app.post("/register",async (req,res)=>{
  const {username,password}=req.body;
  await User.create({username,password});
  res.redirect("/login");
});

// =====================
// LOGIN
// =====================
app.get("/login",(req,res)=>{
  res.send(layout("Login",`
  <form method="POST">
  <input name="username" required><br><br>
  <input name="password" type="password" required><br><br>
  <button>Login</button>
  </form>
  <br>
  <form method="POST" action="/guest">
  <button>Mehmon sifatida kirish</button>
  </form>
  `,req));
});

app.post("/login",async (req,res)=>{
  const {username,password}=req.body;
  const user=await User.findOne({username,password});
  if(!user) return res.send("Xato login");
  req.session.user={username:user.username,role:user.role};
  res.redirect("/");
});

// =====================
// GUEST
// =====================
app.post("/guest",(req,res)=>{
  req.session.user={username:"Mehmon",role:"guest"};
  res.redirect("/");
});

// =====================
// LOGOUT
// =====================
app.get("/logout",(req,res)=>{
  req.session.destroy();
  res.redirect("/login");
});

// =====================
// HOME
// =====================
app.get("/",checkAuth,async (req,res)=>{
  const user=await User.findOne({username:req.session.user.username});
  const files=await File.find({parentFolder:null});

  let html=`
  <form action="/upload" method="POST" enctype="multipart/form-data">
  <input type="file" name="file">
  <button>Yuklash</button>
  </form>

  <form action="/create-folder" method="POST">
  <input name="folderName" placeholder="Papka nomi">
  <button>📁 Papka</button>
  </form>
  <hr>
  `;

  for(let f of files){
    html+=`
    <div class="card">
    ${f.isFolder?"📁":"📄"} ${f.originalName}
    <br>
    👁 ${f.views}
    <br>
    ${
      !f.isFolder?
      `<a href="/download/${f._id}"><button>Yuklab olish</button></a>`
      :
      `<a href="/folder/${f._id}"><button>Kirish</button></a>`
    }
    ${
      req.session.user.role!=="guest"?
      `<form method="POST" action="/delete/${f._id}">
      <button>O‘chirish</button>
      </form>`:""
    }
    <form method="POST" action="/save/${f._id}">
    <button>⭐ Saqlash</button>
    </form>
    </div>
    `;
  }

  res.send(layout("Home",html,req));
});

// =====================
// UPLOAD
// =====================
app.post("/upload",checkAuth,upload.single("file"),async (req,res)=>{
  const user=await User.findOne({username:req.session.user.username});
  await File.create({
    originalName:req.file.originalname,
    name:req.file.filename,
    path:req.file.path,
    uploadedBy:user?._id
  });
  res.redirect("/");
});

// =====================
// CREATE FOLDER
// =====================
app.post("/create-folder",checkAuth,async (req,res)=>{
  const user=await User.findOne({username:req.session.user.username});
  await File.create({
    originalName:req.body.folderName,
    isFolder:true,
    uploadedBy:user?._id
  });
  res.redirect("/");
});

// =====================
// DOWNLOAD + VIEW
// =====================
app.get("/download/:id",async (req,res)=>{
  const file=await File.findById(req.params.id);
  if(!file || file.isFolder) return res.redirect("/");
  file.views+=1;
  await file.save();
  res.download(file.path,file.originalName);
});

// =====================
// DELETE
// =====================
app.post("/delete/:id",checkAuth,async (req,res)=>{
  if(req.session.user.role==="guest"){
    return res.send("Mehmon o‘chira olmaydi");
  }

  const user=await User.findOne({username:req.session.user.username});
  const file=await File.findById(req.params.id);

  if(file.uploadedBy?.toString()!==user?._id.toString()){
    return res.send("Faqat o‘z faylingni o‘chira olasan");
  }

  await File.findByIdAndDelete(req.params.id);
  res.redirect("/");
});

// =====================
// SAVE
// =====================
app.post("/save/:id",checkAuth,async (req,res)=>{
  if(req.session.user.role==="guest"){
    return res.send("Mehmon saqlay olmaydi");
  }

  const user=await User.findOne({username:req.session.user.username});
  if(!user.savedFiles.includes(req.params.id)){
    user.savedFiles.push(req.params.id);
    await user.save();
  }

  res.redirect("/");
});

// =====================
// SAVED PAGE
// =====================
app.get("/saved",checkAuth,async (req,res)=>{
  if(req.session.user.role==="guest"){
    return res.send("Mehmon saqlanganlar yo‘q");
  }

  const user=await User.findOne({username:req.session.user.username}).populate("savedFiles");

  let html="<h2>Saqlanganlarim</h2>";

  user.savedFiles.forEach(f=>{
    html+=`
    <div class="card">
    ${f.originalName}
    <br>
    <a href="/download/${f._id}">
    <button>Yuklab olish</button>
    </a>
    </div>
    `;
  });

  res.send(layout("Saved",html,req));
});

// =====================
app.listen(3000,()=>console.log("Server 3000 da ishlayapti"));