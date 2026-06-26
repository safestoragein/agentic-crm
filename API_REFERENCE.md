# SafeStorage Agentic CRM — Backend API Reference

Backend: CodeIgniter 3 HMVC module `report_analysis`
(`../application_back/modules/report_analysis/`)

**Base URL:** `https://safestorage.in/back/report_analysis/`
Every method returns `{"status":"success","data":[...]}` (a few use `{"success":true,...}`) and `die()`s.
The controller sets CORS `*` — no session/auth required for this module.
Most analytics queries hardcode a **last-6-months** window and accept an empty `$where`.

---

## 1. Analytics / Dashboard (overview KPIs, month-wise)

| Endpoint | Returns |
|---|---|
| `valid_quotations_count` | New customers (quotes) per month |
| `bookings_from_quotes` | Pickup bookings per month |
| `avg_time_taken_for_booking` | Avg days quotation→order |
| `avg_time_taken_from_customer_created` | Avg days customer-created→order |
| `high_value_bookings` | Bookings with storage charges ≥ ₹6000 |
| `avg_booking_value` | Avg storage charge per month |
| `get_last_months_quotes` | Last month valid quote count |
| `last_6_months_bookings` / `last_6_months_completed_bookings` | Booking trend |
| `last_6_months_quotations` | Quotation trend |
| `get_totalcustoners_data` / `get_totalorders_data` / `get_totalcancelledorders_data` | Totals by month |
| `get_lostcustoners_data` | Churned (follow_up='lost') by month |
| `get_churn_analysis_reasons` | Churn grouped by `sub_follow_up` |
| `bangalore_active_customers` | Cumulative active customers in Bangalore |

## 2. CRM-user-wise performance

`valid_quotes_crm_wise`, `bookings_count_crm_wise`, `avg_booking_value_crm_wise`,
`avg_customer_to_booking_crm_wise`, `avg_quotation_to_booking_crm_wise`,
`get_transport_charges_data`, `get_avg_followups_data` — all grouped by
`relationship_manager_id` + month, joined to `ss_user.user_fname`.

## 3. Returning / business / household segments

`get_returning_customer_data`, `get_returning_customer_charges_data`,
`get_returning_customer_dbstart_now_data`, `get_purereturning_customer_dbstart_now_data`,
`get_returning_customers_revenue` (>1 pickup = returning),
`get_total_business_customers`, `get_active_business_customers`,
`get_business_customer_quotations_data`, `get_business_customer_retrieving_data`,
`get_business_customer_charges_data`,
`all_household_active_customers(_charges)`, `all_business_active_customers(_charges)`,
`all_household_orders_data(_charges)`, `all_business_orders_data(_charges)`
(orders accept `?from_date=&to_date=`).

## 4. Payment / collections analysis (accept `?from_date=&to_date=`)

`payment_type_summary`, `household_storage_payment_type_summary`,
`business_storage_payment_type_summary`, `business_transport_payment_type_summary`,
`business_customers_overview_report`, `household_customers_overview_report`,
`household_customers_overview_report_customer_data`,
`business_customers_overview_report_customer_data`, `customers_payment_offers`.
`get_payment_collected` — today's collections by `invoice_user_id`.
`get_unpaid_customers_report`, `get_unpaid_customers_not_followed_up` — unpaid with
storage/transport/labour breakdown.

## 5. AI vs human collection tracking (30-min attribution window)

`track_ai_whatsapp_collection`, `get_ai_collection_report?date=`,
`track_human_collection`, `get_human_collection_report?date=`,
`send_payment_reminder_whatsapp` (POST/GET `customer_id`; skips active full_retrieval).

## 6. CRM team operations (the live CRM screens)

| Endpoint | Method | Notes |
|---|---|---|
| `get_crm_leads_data` | GET | Leads (last month→today) from `ss_leads` |
| `get_crm_login_credentials` | GET | CRM users (role_id=5); password base64-decoded |
| `crm_team_quotations_data` | POST | Quotations; filters: `customer_local_city`, `search_date` (`d-d`), `follow_up`, `relationship_manager_id` |
| `crm_team_quotations_data_follow_ups` | POST | Same, filtered by follow_up_date |
| `crm_team_leads_data_follow_ups` | GET | Leads by follow_up_date |
| `show_bookings_data` | GET | This-month pickup bookings w/ CRM user |
| `show_leads_counts` / `show_quotations_counts` / `show_bookings_counts` | GET | This-month per-user counts |
| `show_user_booking_ranking` | GET | Ranked bookings leaderboard (current month) |
| `show_leads_followups` / `show_quotations_followups` | GET | Yesterday→tomorrow follow-up queue |
| `update_leads_followups_data` | POST | Update `ss_leads` (pipeline_stage, contact_method, follow_up, date, note appended, activity_history) |
| `update_quotation_followups_data` | POST | Same for `ss_customer` (by customer_id) |
| `show_follow_ups?customer_id=` | GET | Current follow-up of a customer |
| `get_calls_data?user_id=` | GET | Unpaid due calls list per user |
| `insert_payments_team_followup_ups` | POST | Payment-team follow-up on `ss_customer` |
| `send_whatsapp_reminder` / `send_leads_messages` / `send_quotes_messages` | POST | Interakt WhatsApp templates |
| `post_internal_complaint` | POST | Create internal complaint |
| `attendance_users_list` | GET | Warehouse-18 staff |
| `save_user_session` / `save_ai_insights` | POST | User activity & AI productivity tracking |
| `post_name_db_save_file_folder` / `serve_audio_file/<f>` | POST/GET | Call-recording audio upload/serve |

## 7. IIT Bombay self-storage boxes (separate sub-app)

`show_boxes_data`, `store_items` (JSON: box_number, phone_number, images[base64]),
`send_storage_whatsapp`, `mark_box_retrieved`, `update_payment_and_retrieve`,
`paytm_process` (initiate/verify), `paytm_callback` → redirects to
`https://safestorage-login.vercel.app/payment-callback`.

## 8. Misc data feeds

`get_google_ads_data`, `show_ads_ai_analysis_data` (`ads_ai_analysis` table),
`show_intercity_and_shifting_data` (`shifting_and_intercity_data` table).

---

## Key tables & conventions
- `ss_customer` — master. `is_customer`: 1=converted, 0=lead/quote. `is_business_cust`: 1=business, NULL/0=household. `status`: '0'=active. `relationship_manager_id`/`invoice_user_id` → `ss_user`.
- `ss_leads` — raw leads (separate from ss_customer).
- `ss_customer_quotation` — quotes (`total_storage_charges_with_gst`, `total_pickup_charges_with_gst`).
- `ss_order` — `order_type` pickup/full_retrieval, `order_status` completed/cancelled/…, `order_schedule_date`.
- `ss_customer_payment` — `payment_status` Paid/Unpaid, `charges_type` NULL=storage / transport_charges / labour_charges / late_fee_charges, `payable_amount`, `billing_date`.
- `ss_customer_transaction` — `paid_amount`, `transaction_created_at`.
- `ss_account_summary` — `total_monthly_charges` (recurring revenue).
- CRM users = `ss_user.role_id = 5`, `status = '0'`.

## Frontend reference (existing)
`../agentic crm/agentic-crm` — React 19 + Vite 7, react-router-dom 7, recharts, lucide-react, sweetalert2. Screens: Login, Dashboard, Leads, Quotations, AIAnalytics. Deploy target: Vercel `https://safestorage-crm.vercel.app` (push every change there).
