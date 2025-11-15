const express = require('express');
const router = express.Router();
const pool = require('../db');
router.get('/user/:userId', async (req, res) => {

    const { userId } = req.params; // This userId is the 'owner_id'
    const { search, sort } = req.query;

    let params = [userId];
    
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
        JOIN 
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

    // 5. Execute the query
    try {
        const [rows] = await pool.execute(sql, params);
        res.json(rows);
    } catch (error) {
        console.error("Failed to fetch user payments:", error);
        res.status(500).json({ message: "Error retrieving payment data" });
    }
});


// --- Scenario 1: Simple Payment Simulation ---
// Endpoint: POST /api/payments/:id/complete
router.post('/:id/complete', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Generate a fake transaction ID
        const fakeTransactionId = `TXN_SIM_${Date.now()}`;

        const [result] = await pool.query(
            `UPDATE Payments 
             SET payment_status = 'Paid', payment_date = NOW(), transaction_id = ? 
             WHERE payment_id = ? AND payment_status = 'Pending'`,
            [fakeTransactionId, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Payment not found or already paid.' });
        }

        res.status(200).json({ 
            message: 'Payment successful!', 
            transaction_id: fakeTransactionId 
        });

    } catch (error) {
        console.error('Error in /:id/complete payment:', error);
        res.status(500).json({ message: 'Server error.' });
    }
});


// --- Scenario 2: Payment AND Ownership Transfer ---
// Endpoint: POST /api/payments/complete-transfer
router.post('/complete-transfer', async (req, res) => {
    const { payment_id, newOwnerId, registrationNumber } = req.body;

    if (!payment_id || !newOwnerId || !registrationNumber) {
        return res.status(400).json({ message: 'Missing payment, user, or vehicle data.' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 1. Mark the payment in the 'Payments' table as 'Paid'
        const transferTransactionId = `TXN_TNSF_${Date.now()}`;
        
        const [paymentUpdate] = await connection.execute(
            `UPDATE Payments 
             SET payment_status = 'Paid', transaction_id = ?, payment_date = NOW()
             WHERE payment_id = ? AND payment_status = 'Pending'`,
            [transferTransactionId, payment_id]
        );

        if (paymentUpdate.affectedRows === 0) {
            throw new Error('Payment not found or already processed.');
        }

        // 2. Perform the actual Ownership Transfer in the 'Registrations' table
        const [regUpdate] = await connection.execute(
            'UPDATE Registrations SET owner_id = ? WHERE registration_number = ?',
            [newOwnerId, registrationNumber]
        );

        if (regUpdate.affectedRows === 0) {
            throw new Error('Failed to update registration. Vehicle not found.');
        }

        // 3. Commit the transaction
        await connection.commit();
        
        res.status(200).json({ 
            message: 'Payment successful! Ownership transferred.',
            transactionId: transferTransactionId
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error in /complete-transfer:', error);
        res.status(500).json({ message: error.message || 'Server error during transfer.' });
    } finally {
        if (connection) connection.release();
    }
});

router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await pool.query(
            'SELECT payment_id, amount, payment_for, payment_status FROM Payments WHERE payment_id = ?', 
            [id]
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