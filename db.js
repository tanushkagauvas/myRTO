// db.js
const mysql = require('mysql2/promise');
const fs = require('fs');
require('dotenv').config(); // Loads the .env file

// Create the connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,

  // THIS IS THE CRITICAL PART for Aiven/PlanetScale
  ssl: {
    // Reads the ca.pem file from your project folder
    ca: fs.readFileSync('ca.pem')
  }
});

// Test the connection logic (optional)
async function testConnection() {
  try {
    console.log("Connecting to database...");
    const connection = await pool.getConnection();
    console.log("🎉 Successfully connected to the database!");
    connection.release();
  } catch (error) {
    console.error("❌ Database connection failed:", error);
  }
}

testConnection();

// Export the pool to be used in other files (like app.js)
module.exports = pool;