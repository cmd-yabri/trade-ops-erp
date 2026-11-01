from rest_framework import serializers

from .models import Role, User

MIN_PASSWORD_LENGTH = 6


def validate_new_password(value: str) -> str:
    if len(value) < MIN_PASSWORD_LENGTH:
        raise serializers.ValidationError(f"كلمة المرور يجب ألا تقل عن {MIN_PASSWORD_LENGTH} أحرف.")
    if not value.strip():
        raise serializers.ValidationError("كلمة المرور لا يمكن أن تكون فراغات فقط.")
    return value


class UserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, allow_blank=False)

    class Meta:
        model = User
        fields = ["id", "first_name", "last_name", "username", "email", "password", "role", "is_active"]
        read_only_fields = ["id"]

    def validate_username(self, value):
        value = value.strip()
        clash = User.objects.filter(username__iexact=value)
        if self.instance:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("اسم المستخدم مستخدم مسبقاً.")
        return value

    def validate_password(self, value):
        return validate_new_password(value)

    def validate(self, attrs):
        if self.instance is None and "password" not in attrs:
            raise serializers.ValidationError({"password": "كلمة المرور مطلوبة."})
        return attrs

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if password:
            instance.set_password(password)
        instance.save()
        return instance


def public_user(user: User) -> dict:
    return {
        "id": str(user.id),
        "username": user.username,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "email": user.email,
        "role": "ADMIN" if user.is_admin_role else "USER",
        "is_active": user.is_active,
    }


__all__ = ["UserSerializer", "validate_new_password", "public_user", "Role"]
