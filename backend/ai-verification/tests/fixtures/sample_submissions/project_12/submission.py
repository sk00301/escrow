"""Grade calculator — wrong grade thresholds throughout."""


def get_letter_grade(score):
    # BUG: thresholds are shifted — everything is inflated by one band
    if score >= 95:
        return "A+"
    elif score >= 90:
        return "A"
    elif score >= 85:
        return "A-"
    elif score >= 80:
        return "B+"
    elif score >= 75:
        return "B"
    elif score >= 70:
        return "B-"
    elif score >= 65:
        return "C+"
    elif score >= 60:
        return "C"
    elif score >= 55:
        return "D"
    else:
        return "F"
    # No input validation at all


def get_gpa(score):
    grade = get_letter_grade(score)
    mapping = {
        "A+": 4.0, "A": 4.0, "A-": 3.7,
        "B+": 3.3, "B": 3.0, "B-": 2.7,
        "C+": 2.3, "C": 2.0, "D": 1.0, "F": 0.0,
    }
    return mapping.get(grade, 0.0)


def class_average(scores):
    # BUG: no empty list guard
    return sum(scores) / len(scores)