-- Chạy tự động mỗi lần server khởi động (an toàn khi chạy lại nhiều lần)

CREATE TABLE IF NOT EXISTS quizzes (
  id          text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{12}$'),
  title       text NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Mỗi câu hỏi thuộc một bộ; xoá bộ thì xoá luôn các câu hỏi
CREATE TABLE IF NOT EXISTS questions (
  quiz_id   text NOT NULL REFERENCES quizzes (id) ON DELETE CASCADE,
  position  smallint NOT NULL,
  question  text NOT NULL CHECK (length(question) BETWEEN 1 AND 300),
  answers   text[] NOT NULL CHECK (array_length(answers, 1) = 4),
  correct   smallint NOT NULL CHECK (correct BETWEEN 0 AND 3),
  time_sec  smallint NOT NULL CHECK (time_sec BETWEEN 5 AND 120),
  PRIMARY KEY (quiz_id, position)
);
