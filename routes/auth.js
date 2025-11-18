// File: routes/auth.js

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs'); // You need bcrypt here
const pool = require('../db');     // Import your shared database pool

// --- (New) Register User Route ---
// Path: POST /api/register
router.post('/register', async (req, res) => {
  try {
    const { 
      full_name, dob, email, pan_number, // REMOVED: phone_number
      address_line1, city, state, pincode, password 
    } = req.body;

    // Removed phone_number from validation
    if (!full_name || !dob || !email || !pan_number || 
        !address_line1 || !city || !state || !pincode || !password) {
      return res.status(400).json({ message: 'Please provide all required fields.' });
    }

    // Removed phone_number check from existing user query
    const [existingUser] = await pool.query(
      'SELECT * FROM Users WHERE email = ? OR pan_number = ?',
      [email, pan_number]
    );

    if (existingUser.length > 0) {
      if (existingUser[0].email === email) {
        return res.status(409).json({ message: 'Email already in use.' });
      }
      if (existingUser[0].pan_number === pan_number) {
        return res.status(409).json({ message: 'PAN Number already registered.' });
      }
      // Removed phone_number conflict check
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Removed phone_number from INSERT columns and values
    const sql = `
      INSERT INTO Users (
        full_name, dob, email, pan_number, 
        address_line1, city, state, pincode, password_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const values = [
      full_name, dob, email, pan_number,
      address_line1, city, state, pincode, passwordHash
    ];

    const [result] = await pool.query(sql, values);
    console.log('User created with ID:', result.insertId);
    res.status(201).json({ message: 'User registered successfully!' });

  } catch (error) {
    console.error('Error during registration:', error);
    res.status(500).json({ message: 'Server error during registration.' });
  }
});

// --- (Existing) Login User Route ---
// Path: POST /api/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Please provide email and password.' });
    }

    const [existingUser] = await pool.query(
      'SELECT * FROM Users WHERE email = ?',
      [email]
    );

    if (existingUser.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const user = existingUser[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    console.log(`User ${user.email} (ID: ${user.user_id}) logged in successfully.`);
    
    res.status(200).json({ 
      message: 'Login successful!',
      user: {
        id: user.user_id, // Use user_id from your schema
        fullName: user.full_name,
        email: user.email
      } 
    });

  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ message: 'Server error during login.' });
  }
});

module.exports = router;