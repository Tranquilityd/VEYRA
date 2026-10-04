-- Synthetic representative data for disposable migration rehearsal only.
-- Contains no Production credentials, PII, wallet keys, or real transaction hashes.
INSERT INTO users(id,wallet_address,referral_code,created_at,last_activity_at,social_verified_at) VALUES
 ('00000000-0000-4000-8000-000000000001','0x0000000000000000000000000000000000000001','REF00001',NOW()-INTERVAL '120 days',NOW()-INTERVAL '1 day',NOW()-INTERVAL '30 days'),
 ('00000000-0000-4000-8000-000000000002','0x0000000000000000000000000000000000000002','REF00002',NOW()-INTERVAL '90 days',NOW()-INTERVAL '2 days',NULL),
 ('00000000-0000-4000-8000-000000000003','0x0000000000000000000000000000000000000003','REF00003',NOW()-INTERVAL '60 days',NOW(),NOW()-INTERVAL '10 days');
INSERT INTO auth_challenges(id,wallet_address,nonce_hash,message,expires_at,used_at) VALUES
 ('10000000-0000-4000-8000-000000000001','0x0000000000000000000000000000000000000001','synthetic-hash','synthetic-message',NOW()-INTERVAL '100 days',NOW()-INTERVAL '100 days');
INSERT INTO admin_login_attempts(ip_hash,succeeded,attempted_at) VALUES ('synthetic-ip-hash',true,NOW()-INTERVAL '1 day'),('synthetic-ip-hash-2',false,NOW()-INTERVAL '2 days');
INSERT INTO arcade_balances(user_id,balance,lifetime_earned,lifetime_withdrawn) VALUES
 ('00000000-0000-4000-8000-000000000001',0.01500000,0.02500000,0.01000000),
 ('00000000-0000-4000-8000-000000000002',0.02000000,0.02000000,0),
 ('00000000-0000-4000-8000-000000000003',0.00750000,0.01250000,0.00500000);
INSERT INTO game_sessions(id,user_id,game,score,waves,reward,started_at,ended_at,validation_status,validation_reason,client_session_id) VALUES
 ('20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','memrush',4,4,0.00004000,NOW()-INTERVAL '40 days',NOW()-INTERVAL '40 days','validated','server_time_and_bounds_validated','legacy_mem_0001'),
 ('20000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','zdodge',8,3,0.00003000,NOW()-INTERVAL '20 days',NOW()-INTERVAL '20 days','validated','server_time_and_bounds_validated','legacy_zd_0002'),
 ('20000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000003','zshooter',18,2,0.00002000,NOW()-INTERVAL '10 days',NOW()-INTERVAL '10 days','validated','server_time_and_bounds_validated','legacy_zs_0003');
INSERT INTO arcade_reward_history(id,user_id,game_session_id,amount,balance_after,reason,created_at) VALUES
 ('30000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',0.00004000,0.01500000,'arcade_session',NOW()-INTERVAL '40 days'),
 ('30000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002',0.00003000,0.02000000,'arcade_session',NOW()-INTERVAL '20 days'),
 ('30000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003',0.00002000,0.00750000,'arcade_session',NOW()-INTERVAL '10 days');
INSERT INTO casino_sessions(id,user_id,game,wager,result,payout,wager_tx_hash,payout_tx_hash,status,started_at,resolved_at) VALUES
 ('40000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','plinko',0.00100000,'{"engine":"veyra-backend","synthetic":true}',0.00150000,'0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','paid',NOW()-INTERVAL '30 days',NOW()-INTERVAL '30 days'),
 ('40000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','coin',0.00050000,'{"engine":"veyra-backend","synthetic":true}',0,'0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',NULL,'resolved',NOW()-INTERVAL '15 days',NOW()-INTERVAL '15 days');
INSERT INTO casino_claims(id,casino_session_id,user_id,player_wallet,wager,payout,claim_nonce,status,transaction_hash,created_at,claimed_at) VALUES
 ('50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','0x0000000000000000000000000000000000000001',0.00100000,0.00150000,'synthetic-nonce-1','claimed','0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',NOW()-INTERVAL '30 days',NOW()-INTERVAL '30 days');
INSERT INTO referrals(id,referrer_id,referred_user_id,referral_code,qualification_status,reward_status,created_at) VALUES
 ('60000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','REF00001','qualified','credited',NOW()-INTERVAL '80 days');
INSERT INTO social_verifications(id,user_id,x_username,screenshot_reference,screenshot_data,screenshot_mime,attempt_number,submitted_at,status,reviewed_at,reviewer) VALUES
 ('70000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','synthetic_one','synthetic://proof/1',decode('89504e47','hex'),'image/png',1,NOW()-INTERVAL '31 days','approved',NOW()-INTERVAL '30 days','synthetic-admin'),
 ('70000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','synthetic_two','synthetic://proof/2',decode('ffd8ffe0','hex'),'image/jpeg',1,NOW()-INTERVAL '2 days','pending',NULL,NULL);
INSERT INTO withdrawals(id,user_id,amount,wallet,status,requested_at,updated_at) VALUES
 ('80000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',0.00500000,'0x0000000000000000000000000000000000000001','eligible',NOW()-INTERVAL '25 days',NOW()-INTERVAL '25 days'),
 ('80000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002',0.00600000,'0x0000000000000000000000000000000000000002','submitted',NOW()-INTERVAL '20 days',NOW()-INTERVAL '20 days'),
 ('80000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000003',0.00500000,'0x0000000000000000000000000000000000000003','confirmed',NOW()-INTERVAL '15 days',NOW()-INTERVAL '15 days'),
 ('80000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000002',0.00500000,'0x0000000000000000000000000000000000000002','rejected',NOW()-INTERVAL '10 days',NOW()-INTERVAL '10 days'),
 ('80000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001',0.00500000,'0x0000000000000000000000000000000000000001','pending',NOW()-INTERVAL '1 day',NOW()-INTERVAL '1 day');
INSERT INTO blockchain_transactions(id,user_id,type,amount,contract_address,transaction_hash,status,related_entity_type,related_entity_id,block_number,confirmations,metadata) VALUES
 ('90000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','casino_wager',0.00100000,'0xd2c36B83B1Ca788743E3E9b339e043b6B04e3273','0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','confirmed','casino_session','40000000-0000-4000-8000-000000000001',12345,2,'{"synthetic":true}'),
 ('90000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','casino_payout',0.00150000,'0xd2c36B83B1Ca788743E3E9b339e043b6B04e3273','0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','confirmed','casino_claim','50000000-0000-4000-8000-000000000001',12346,2,'{"synthetic":true}');
INSERT INTO audit_logs(id,user_id,action,entity_type,entity_id,metadata,created_at) VALUES
 (1001,'00000000-0000-4000-8000-000000000001','synthetic.account.created','user','00000000-0000-4000-8000-000000000001','{}',NOW()-INTERVAL '120 days'),
 (1002,'00000000-0000-4000-8000-000000000001','synthetic.withdrawal.requested','withdrawal','80000000-0000-4000-8000-000000000001','{}',NOW()-INTERVAL '25 days'),
 (1003,'00000000-0000-4000-8000-000000000001','synthetic.casino.paid','casino_session','40000000-0000-4000-8000-000000000001','{}',NOW()-INTERVAL '30 days');
