const express = require('express');
const router = express.Router();
const pool = require('../db');

// 1. GET all payments for a specific user
router.get('/user/:userId', async (req, res) => {

    const { userId } = req.params; 
    const { search, sort } = req.query;

    let params = [userId];
    
    // JOIN logic to link Payments with Registrations to verify ownership
    let sql = `
       SELECT 
        P.transaction_id,
        P.payment_date,
        P.payment_for AS service_name,
        P.amount,
        P.payment_status,
        R.registration_number
    FROM 
        Payments AS P
    LEFT JOIN 
        Registrations AS R ON P.application_id = R.application_id
    WHERE 
        R.owner_id = ?
    `;

    // 3. Add dynamic SEARCH logic
    if (search) {
        sql += " AND (P.payment_for LIKE ? OR P.transaction_id LIKE ?)";
        params.push(`%${search}%`);
        params.push(`%${search}%`);
    }

    // 4. Add dynamic SORT logic
    let orderByClause = " ORDER BY P.payment_date DESC";
    switch (sort) {
        case 'oldest':
            orderByClause = " ORDER BY P.payment_date ASC";
            break;
        case 'amount_high':
            orderByClause = " ORDER BY P.amount DESC";
            break;
        case 'amount_low':
            orderByClause = " ORDER BY P.amount ASC";
            break;
        case 'newest':
        default:
            orderByClause = " ORDER BY P.payment_date DESC";
            break;
    }
    sql += orderByClause;

    // 5. Execute the query using pool.query (Safer than execute for dynamic SQL)
    try {
        const [rows] = await pool.query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error("Failed to fetch user payments:", error);
        res.status(500).json({ message: "Error retrieving payment data" });
    }
});

// ... (Keep the rest of your POST routes for completion/transfer as they were) ...

// --- Scenario 1: Simple Payment Simulation ---
router.post('/:transactionId/complete', async (req, res) => {
    try {
        const { transactionId } = req.params;
        
        const [result] = await pool.query(
            `UPDATE Payments 
             SET payment_status = 'Paid', payment_date = NOW()
             WHERE transaction_id = ? AND payment_status = 'Pending'`,
            [transactionId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Payment record not found or already paid.' });
        }

        res.status(200).json({ 
            message: 'Payment successful!', 
            transaction_id: transactionId 
        });

    } catch (error) {
        console.error('Error in /:transactionId/complete payment:', error);
        res.status(500).json({ message: 'Server error.' });
    }
});

// --- Scenario 2: Payment AND Ownership Transfer ---
router.post('/complete-transfer', async (req, res) => {
    const { transaction_id, newOwnerId, registrationNumber } = req.body;

    if (!transaction_id || !newOwnerId || !registrationNumber) {
        return res.status(400).json({ message: 'Missing transaction ID, user, or vehicle data.' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 1. Mark payment as Paid
        const [paymentUpdate] = await connection.query(
            `UPDATE Payments 
             SET payment_status = 'Paid', payment_date = NOW()
             WHERE transaction_id = ? AND payment_status = 'Pending'`,
            [transaction_id]
        );

        if (paymentUpdate.affectedRows === 0) {
            throw new Error('Payment not found or already processed.');
        }

        // 2. Update Registration Owner
        const [regUpdate] = await connection.query(
            'UPDATE Registrations SET owner_id = ? WHERE registration_number = ?',
            [newOwnerId, registrationNumber]
        );

        if (regUpdate.affectedRows === 0) {
            throw new Error('Failed to update registration. Vehicle not found.');
        }

        await connection.commit();
        
        res.status(200).json({ 
            message: 'Payment successful! Ownership transferred.',
            transactionId: transaction_id
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error in /complete-transfer:', error);
        res.status(500).json({ message: error.message || 'Server error during transfer.' });
    } finally {
        if (connection) connection.release();
    }
});

// 3. Get Single Payment Details
router.get('/:transactionId', async (req, res) => {
    try {
        const { transactionId } = req.params;
        const [rows] = await pool.query(
            'SELECT transaction_id, amount, payment_for, payment_status FROM Payments WHERE transaction_id = ?', 
            [transactionId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Payment record not found.' });
        }
        res.status(200).json(rows[0]);

    } catch (error) {
        console.error('Error fetching payment details:', error);
        res.status(500).json({ message: 'Server error.' });
    }
});

module.exports = router;
