const express = require('express');
const router = express.Router();
const pool = require('../db');

// ✅ 1. GET user details
router.get('/user/:id', async (req, res) => {
    try {
        const { id } = req.params;
        // REMOVED: phone_number from this SELECT list
        const [userRows] = await pool.query(
            'SELECT full_name, email, pan_number, address_line1, city, state, pincode FROM Users WHERE user_id = ?',
            [id]
        );

        if (userRows.length === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }

        res.status(200).json(userRows[0]);
    } catch (error) {
        console.error('Error fetching user data:', error);
        res.status(500).json({ message: 'Server error fetching user data.' });
    }
});

// NEW: Updated route to handle backend sorting and filtering
router.get('/user/:userId/vehicles', async (req, res) => {
    const { userId } = req.params;
    const { search = '', sort = 'default' } = req.query;

    try {
        let sql = 'SELECT * FROM v_UserVehicleDetails WHERE user_id = ?';
        const params = [userId];

        if (search) {
            sql += ' AND registration_number LIKE ?';
            params.push(`%${search}%`);
        }

        let orderByClause = '';
        switch (sort) {
            case 'reg_expiring':
                orderByClause = 'ORDER BY registration_valid_upto ASC';
                break;
            case 'ins_expiring':
                orderByClause = 'ORDER BY insurance_end_date ASC';
                break;
            case 'alphabetical':
                orderByClause = 'ORDER BY registration_number ASC';
                break;
            default:
                orderByClause = 'ORDER BY registration_number DESC';
        }

        sql += ` ${orderByClause}`;

        const [results] = await pool.query(sql, params);
        res.status(200).json(results);

    } catch (err) {
        console.error("Error fetching from view:", err);
        res.status(500).json({ error: "Database query failed" });
    }
});

// --- *** MODIFIED REGISTRATION ROUTE *** ---
router.post('/register', async (req, res) => {
    const connection = await pool.getConnection();

    try {
        // 1. Removed 'make' and 'manufacture_year' from input
        const {
            owner_id, chassis_number, engine_number, model, vehicle_class, fuel_type,
            dealer_name, purchase_date, ex_showroom_price, rto_office_code,
            company_name, policy_number, policy_type, start_date, end_date
        } = req.body;

        // --- 1. Calculate Road Tax ---
        const roadTax = parseFloat(ex_showroom_price) * 0.08;

        // --- 2. START THE TRANSACTION ---
        await connection.beginTransaction();

        // --- 1b. Generate Temporary Registration Number ---
        const timestamp = Date.now().toString().slice(-6);
        const tempRegNumber = `${rto_office_code}-${timestamp}`;

        // 3. Insert into 'Vehicles' table
        // Columns: 6, Placeholders: 6
        const vehicleSql = `
            INSERT INTO Vehicles (
                chassis_number, engine_number, model, 
                fuel_type, vehicle_class
            ) VALUES (?, ?, ?, ?, ?)
        `;
        await connection.query(vehicleSql, [
            chassis_number, engine_number, model,
            fuel_type, vehicle_class // Defaulting seating to 5
        ]);

        // 4. Insert into 'Registrations' table
        const regSql = `
            INSERT INTO Registrations (
                owner_id, chassis_number, application_date, rto_office_code, 
                application_status, dealer_name, purchase_date, ex_showroom_price,
                road_tax_amount, registration_number, registration_date, valid_upto
            ) VALUES (?, ?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(?, INTERVAL 15 YEAR))
        `;
        
        const [regResult] = await connection.query(regSql, [
            owner_id, chassis_number, rto_office_code,
            'Submitted', 
            dealer_name, purchase_date, ex_showroom_price,
            roadTax, tempRegNumber, purchase_date, purchase_date
        ]);

        const newApplicationId = regResult.insertId;

        // 5. Insert into 'Insurance' table
        const insSql = `
            INSERT INTO Insurance (
                policy_number, application_id, company_name, policy_type, 
                start_date, end_date
            ) VALUES (?, ?, ?, ?, ?, ?)
        `;
        await connection.query(insSql, [
            policy_number, newApplicationId, company_name, policy_type,
            start_date, end_date
        ]);

        // --- 7. CREATE THE PENDING PAYMENT ---
        const newTransactionId = `TXN-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

        const paymentSql = `
            INSERT INTO Payments (
                transaction_id,
                application_id, 
                payment_for, 
                amount, 
                payment_status
            ) VALUES (?, ?, ?, ?, ?)
        `;

        await connection.query(paymentSql, [
            newTransactionId,
            newApplicationId,
            'New Registration', 
            roadTax,
            'Pending'           
        ]);

        // --- 8. COMMIT ---
        await connection.commit();

        res.status(201).json({
            message: 'Vehicle registration submitted. Proceed to payment.',
            applicationId: newApplicationId,
            registration_number: tempRegNumber,
            payment_id: newTransactionId
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error during vehicle registration transaction:', error);
        
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'This Chassis Number or Engine Number is already registered.' });
        }
        res.status(500).json({ message: 'Server error during vehicle registration.' });
    } finally {
        connection.release();
    }
});


// --- Renew Registration Route ---
router.post('/renew', async (req, res) => {
    const connection = await pool.getConnection();

    try {
        const {
            user_id, registration_number, policy_number,
            company_name, policy_type, start_date, end_date
        } = req.body;

        const findSql = `
            SELECT application_id, owner_id, valid_upto 
            FROM Registrations 
            WHERE registration_number = ?
        `;
        const [regRows] = await connection.query(findSql, [registration_number]);

        if (regRows.length === 0) {
            await connection.release();
            return res.status(404).json({ message: 'Registration number not found.' });
        }

        const registration = regRows[0];

        if (registration.owner_id.toString() !== user_id.toString()) {
            await connection.release();
            return res.status(403).json({ message: 'Forbidden. You do not own this vehicle.' });
        }
        
        const oldValidUpto = registration.valid_upto;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const expiryDate = new Date(oldValidUpto);
        expiryDate.setHours(0, 0, 0, 0);

        if (expiryDate >= today) {
            await connection.release();
            return res.status(400).json({
                message: `Renewal is not yet due. Your vehicle is valid until ${expiryDate.toDateString()}.`
            });
        }
        
        await connection.beginTransaction();

        // --- 5. Update the Registration Table ---
        const [newValidUptoRows] = await connection.query(
            'SELECT DATE_ADD(?, INTERVAL 15 YEAR) AS new_date',
            [oldValidUpto]
        );
        const newValidUpto = newValidUptoRows[0].new_date;

        const updateRegSql = `
            UPDATE Registrations
            SET valid_upto = ?
            WHERE application_id = ?
        `;
        await connection.query(updateRegSql, [newValidUpto, registration.application_id]);

        // --- 6. Update the Insurance Table ---
        const deleteInsSql = 'DELETE FROM Insurance WHERE application_id = ?';
        await connection.query(deleteInsSql, [registration.application_id]);

        const insertInsSql = `
            INSERT INTO Insurance 
                (policy_number, application_id, company_name, policy_type, start_date, end_date)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        await connection.query(insertInsSql, [
            policy_number, registration.application_id, company_name,
            policy_type, start_date, end_date
        ]);

        // --- 7. Log this renewal in the history table ---
        const historySql = `
            INSERT INTO Renewal_History 
                (application_id, renewal_date, old_valid_upto, new_valid_upto, new_policy_number)
            VALUES (?, CURDATE(), ?, ?, ?)
        `;

        await connection.query(historySql, [
            registration.application_id,
            oldValidUpto,
            newValidUpto,
            policy_number
        ]);

        // --- 8. Commit all changes ---
        await connection.commit();

        res.status(200).json({
            message: `Registration ${registration_number} renewed successfully!`
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error during registration renewal:', error);
        res.status(500).json({ message: 'Server error during renewal.' });
    } finally {
        connection.release();
    }
});

module.exports = router;