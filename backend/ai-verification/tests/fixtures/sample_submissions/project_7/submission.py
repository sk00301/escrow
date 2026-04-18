"""Grade calculator — boundary logic error in C/D range."""


def get_letter_grade(score):
    if not (0 <= score <= 100):
        raise ValueError("Score out of range.")
    if score >= 90:
        return "A+"
    elif score >= 85:
        return "A"
    elif score >= 80:
        return "A-"
    elif score >= 75:
        return "B+"
    elif score >= 70:
        return "B"
    elif score >= 65:
        return "B-"
    elif score >= 60:
        return "C+"
    elif score >= 55:
        return "C"
    elif score >= 55:        # BUG: should be >= 50 — dead branch, D never returned
        return "D"
    else:
        return "F"


def get_gpa(score):
    grade = get_letter_grade(score)
    mapping = {
        "A+": 4.0, "A": 4.0, "A-": 3.7,
        "B+": 3.3, "B": 3.0, "B-": 2.7,
        "C+": 2.3, "C": 2.0, "D": 1.0, "F": 0.0,
    }
    return mapping.get(grade, 0.0)


def class_average(scores):
    if not scores:
        raise ValueError("Empty list.")
    return sum(scores) / len(scores)