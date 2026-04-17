import pytest
from submission import get_letter_grade, get_gpa, class_average


def test_grade_a_plus():
    assert get_letter_grade(95) == "A+"

def test_grade_b():
    assert get_letter_grade(72) == "B"

def test_grade_f():
    assert get_letter_grade(30) == "F"

def test_exact_boundary_90():
    assert get_letter_grade(90) == "A+"

def test_exact_boundary_50():
    assert get_letter_grade(50) == "D"

def test_invalid_score_high():
    with pytest.raises(ValueError):
        get_letter_grade(105)

def test_invalid_score_negative():
    with pytest.raises(ValueError):
        get_letter_grade(-1)

def test_gpa_mapping():
    assert get_gpa(85) == 4.0

def test_class_average():
    assert class_average([80, 90, 70]) == 80.0

def test_class_average_empty():
    with pytest.raises(ValueError):
        class_average([])