-- Staff shift / section placement (run once against octavia_production)
CREATE TABLE IF NOT EXISTS staff_assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  work_date DATE NOT NULL,
  shift_id INT NOT NULL,
  assignment_role VARCHAR(32) NOT NULL,
  production_line_id INT NULL,
  machine_id INT NULL,
  notes TEXT NULL,
  created_by INT NULL,
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_staff_user_date_shift (user_id, work_date, shift_id),
  KEY ix_staff_work_date (work_date),
  KEY ix_staff_shift (shift_id),
  CONSTRAINT fk_staff_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_staff_shift FOREIGN KEY (shift_id) REFERENCES shifts (id),
  CONSTRAINT fk_staff_line FOREIGN KEY (production_line_id) REFERENCES production_lines (id),
  CONSTRAINT fk_staff_machine FOREIGN KEY (machine_id) REFERENCES machines (id),
  CONSTRAINT fk_staff_creator FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
