const express = require('express');
const cors = require('cors');
const app = express();
const port = 3000;
const pool = require('./db');

app.use(cors());
app.use(express.json());

// --- Import Routes ---
const authRoutes = require('./routes/auth');
const vehicleRoutes = require('./routes/vehicles');
const transferRoutes = require('./routes/transfer'); // ✅ UNCOMMENTED THIS
const paymentRoutes = require('./routes/payment'); 

// --- Link Routes ---
app.use('/api', authRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/vehicles', transferRoutes); // ✅ UNCOMMENTED THIS (It shares the /api/vehicles path)

// Mount payment routes
app.use('/api/payments', paymentRoutes);

// --- (NEW) ROUTE: Get ONE user's profile ---
app.get('/api/get-my-profile/:user_id', async (req, res) => {
  try {
    const { user_id } = req.params;
    if (!user_id) {
      return res.status(400).json({ message: 'User ID is required.' });
    }

    // This query gets all info for ONE user
    const sql = `
      SELECT
        u.user_id, u.full_name, u.dob, u.email, u.pan_number,
        u.address_line1, u.city, u.state, u.pincode,

        l.llno, l.class, l.status AS ll_status,
        
        s.test_date, s.time_slot, s.status AS test_status
      FROM Users u
      LEFT JOIN ll l ON u.user_id = l.user_id
      LEFT JOIN scheduletest s ON l.llno = s.llno
      WHERE u.user_id = ?
      LIMIT 1 
    `;
    
    const [rows] = await pool.query(sql, [user_id]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    if (rows[0].llno === null) {
        return res.status(404).json({ message: 'No application found for this user.' });
    }

    res.status(200).json(rows[0]);

  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ message: 'Server error while fetching profile.' });
  }
});

// --- ROUTE: Apply for Learner's License ---
app.post('/api/apply-ll', async (req, res) => {
  try {
    const { user_id, license_classes } = req.body;

    if (!user_id || !license_classes || license_classes.length === 0) {
      return res.status(400).json({ message: 'User ID and at least one license class are required.' });
    }
    
    const sql = "INSERT INTO ll (class, user_id) VALUES (?, ?)";
    const values = [license_classes, user_id];

    const [result] = await pool.query(sql, values);
    const newLlno = result.insertId;

    console.log(`LL Application submitted for user ${user_id} with LLN ${newLlno}`);
    res.status(201).json({ 
      message: 'License application submitted successfully!', 
      llno: newLlno
    });

  } catch (error) {
    if (error.code === 'ER_NO_REFERENCED_ROW_2') {
      return res.status(404).json({ message: 'Invalid User ID. User not found.' });
    }
    if (error.code === 'ER_DUP_ENTRY') {
       return res.status(409).json({ message: 'An application for this user already exists or a key error occurred.' });
    }
    
    console.error('Error submitting license application:', error);
    res.status(500).json({ message: 'Server error while submitting application.' });
  }
});

// --- ROUTE: Verify LLN before redirecting ---
app.post('/api/verify-lln', async (req, res) => {
    try {
        const { llno, user_id } = req.body;

        if (!llno || !user_id) {
            return res.status(400).json({ message: 'LLN and User ID are required.' });
        }

        const [ll_records] = await pool.query(
            'SELECT * FROM ll WHERE llno = ? AND user_id = ?',
            [llno, user_id]
        );

        if (ll_records.length === 0) {
            return res.status(404).json({ message: 'LLN not found or does not belong to this user.' });
        }

        res.status(200).json({ message: 'LLN verified successfully.' });

    } catch (error) {
        console.error('Error verifying LLN:', error);
        res.status(500).json({ message: 'Server error during LLN verification.' });
    }
});


// --- ROUTE: Schedule Driving Test ---
app.post('/api/schedule-test', async (req, res) => {
  try {
    const { user_id, llno, test_date, time_slot } = req.body;

    if (!user_id || !llno || !test_date || !time_slot) {
      return res.status(400).json({ message: 'Missing required fields for scheduling.' });
    }

    // *** Verification Step ***
    const [ll_records] = await pool.query(
      'SELECT * FROM ll WHERE llno = ? AND user_id = ?',
      [llno, user_id]
    );

    if (ll_records.length === 0) {
      return res.status(404).json({ message: 'Invalid LLN or LLN does not belong to this user.' });
    }
    
    const sql = `
      INSERT INTO scheduletest (llno, user_id, test_date, time_slot, status)
      VALUES (?, ?, ?, ?, 'Scheduled')
    `;
    const values = [llno, user_id, test_date, time_slot];

    const [result] = await pool.query(sql, values);
    const newApplicationId = result.insertId;

    console.log(`DL Test scheduled for user ${user_id} with LLN ${llno}. New App ID: ${newApplicationId}`);

    res.status(201).json({
      message: 'Test scheduled successfully!',
      applicationId: newApplicationId
    });

  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'You already have an active test scheduled for this LLN.' });
    }
    if (error.code === 'ER_NO_REFERENCED_ROW_2') {
      return res.status(404).json({ message: 'Invalid LLN or User ID.' });
    }
    
    console.error('Error scheduling test:', error);
    res.status(500).json({ message: 'Server error while scheduling test.' });
  }
});

// Start server
app.listen(port, () => {
    console.log(`✅ Server running at http://localhost:${port}`);
});