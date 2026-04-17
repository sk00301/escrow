"""Student grade calculator with letter grade and GPA mapping."""


GRADE_BOUNDARIES = [
    (90, "A+", 4.0),
    (85, "A",  4.0),
    (80, "A-", 3.7),
    (75, "B+", 3.3),
    (70, "B",  3.0),
    (65, "B-", 2.7),
    (60, "C+", 2.3),
    (55, "C",  2.0),
    (50, "D",  1.0),
    (0,  "F",  0.0),
]


def get_letter_grade(score):
    """Return the letter grade for a numeric score 0-100.

    Args:
        score (float): Numeric score between 0 and 100 inclusive.

    Returns:
        str: Letter grade string.

    Raises:
        ValueError: If score is outside the range 0-100.
    """
    if not (0 <= score <= 100):
        raise ValueError(f"Score must be between 0 and 100, got {score}.")
    for threshold, letter, _ in GRADE_BOUNDARIES:
        if score >= threshold:
            return letter
    return "F"


def get_gpa(score):
    """Return the GPA equivalent for a numeric score 0-100.

    Raises:
        ValueError: If score is outside the range 0-100.
    """
    if not (0 <= score <= 100):
        raise ValueError(f"Score must be between 0 and 100, got {score}.")
    for threshold, _, gpa in GRADE_BOUNDARIES:
        if score >= threshold:
            return gpa
    return 0.0


def class_average(scores):
    """Return the average of a list of scores.

    Raises:
        ValueError: If scores list is empty.
    """
    if not scores:
        raise ValueError("Score list cannot be empty.")
    return sum(scores) / len(scores)