const express = require('express');
const router = express.Router();
const pool = require('../db');

// --- 1. Fetch Vehicle & Seller Details ---
// Called when the user types in the Registration Number
router.post('/fetch-transfer-details', async (req, res) => {
    const { registration_number, user_id } = req.body;

    if (!registration_number || !user_id) {
        return res.status(400).json({ message: 'Missing registration number or user ID.' });
    }

    try {
        const sql = `
            SELECT 
                r.application_id, r.owner_id,
                v.vehicle_class, v.model, v.engine_number, v.chassis_number,
                u.full_name AS seller_name, 
                u.address_line1 AS seller_address, 
                u.city AS seller_city, 
                u.state AS seller_state, 
                u.pincode AS seller_pincode
            FROM Registrations r
            JOIN Vehicles v ON r.chassis_number = v.chassis_number
            JOIN Users u ON r.owner_id = u.user_id
            WHERE r.registration_number = ?
        `;
        const [rows] = await pool.query(sql, [registration_number]);

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Registration number not found.' });
        }
        const data = rows[0];
        
        // Security Check: Is the logged-in user the owner?
        if (data.owner_id.toString() !== user_id.toString()) {
            return res.status(403).json({ message: 'Authorization failed: You are not the owner of this vehicle.' });
        }

        res.status(200).json(data);
    } catch (error) {
        console.error('Error fetching transfer details:', error);
        res.status(500).json({ message: 'Server error fetching vehicle data.' });
    }
});

// --- 2. Fetch Buyer Details by PAN ---
// Called when the user types in the Buyer's PAN
router.post('/fetch-buyer-details', async (req, res) => {
    const { pan_number } = req.body;
    if (!pan_number) {
        return res.status(400).json({ message: 'PAN number is required.' });
    }
    try {
        // REMOVED: phone_number from this list
        const [rows] = await pool.query(
            'SELECT user_id, full_name, address_line1, city, state, pincode FROM Users WHERE pan_number = ?',
            [pan_number]
        );
        if (rows.length === 0) {
            return res.status(404).json({ message: 'User with this PAN number not found.' });
        }
        res.status(200).json(rows[0]);
    } catch (error) {
        console.error('Error fetching buyer details:', error);
        res.status(500).json({ message: 'Server error fetching buyer data.' });
    }
});

// --- 3. Create Transfer Payment (Save Draft) ---
router.post('/create-transfer-payment', async (req, res) => {
    const { application_id, new_owner_id, user_id } = req.body;
    const transferFee = 500.00; 

    if (!application_id || !new_owner_id || !user_id) {
        return res.status(400).json({ message: 'Missing application, buyer, or seller ID.' });
    }

    let connection;
    try {
        connection = await pool.getConnection();

        // Check ownership one last time
        const [regRows] = await connection.query(
            'SELECT owner_id FROM Registrations WHERE application_id = ?',
            [application_id]
        );
        if (regRows.length === 0) throw new Error('Application not found.');
        if (regRows[0].owner_id.toString() !== user_id.toString()) throw new Error('Authorization failed.');

        // --- "Save as Draft" Logic ---
        
        // 1. Generate Transaction ID Manually (Since we removed Auto Increment ID)
        const newTransactionId = `TXN-TNSF-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        // 2. Insert into Payments with the manually generated ID
        const sql = `
            INSERT INTO Payments (
                transaction_id, 
                application_id, 
                payment_for, 
                amount, 
                payment_status
            ) VALUES (?, ?, 'Ownership Transfer', ?, 'Pending')
        `;
        
        await connection.execute(sql, [newTransactionId, application_id, transferFee]);

        res.status(201).json({
            message: 'Pending payment created (Draft saved).',
            payment_id: newTransactionId, // Return the string ID
            amount: transferFee,
            new_owner_id: new_owner_id,
            application_id: application_id
        });
    } catch (error) {
        console.error('Error in /create-transfer-payment:', error);
        res.status(500).json({ message: error.message || 'Server error creating pending payment.' });
    } finally {
        if (connection) connection.release();
    }
});

module.exports = router;