from decimal import Decimal, InvalidOperation

from rest_framework import serializers, status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from inventory.stock import default_branch
from tradeops.currency import MultiCurrencyMixin
from tradeops.errors import ConflictError, require_admin, require_feature

from . import services
from .models import Account, AccountEntry, AccountPayment

NOT_FOUND = {"detail": "الحساب غير موجود."}


class AccountSerializer(serializers.ModelSerializer):
    class Meta:
        model = Account
        fields = ["id", "name", "phone", "address", "is_customer", "is_supplier", "notes", "is_active"]

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("اسم الحساب مطلوب.")
        clash = Account.objects.filter(name__iexact=value)
        if self.instance:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("يوجد حساب بهذا الاسم.")
        return value

    def validate(self, attrs):
        customer = attrs.get("is_customer", self.instance.is_customer if self.instance else True)
        supplier = attrs.get("is_supplier", self.instance.is_supplier if self.instance else False)
        if not customer and not supplier:
            raise serializers.ValidationError("اختر نوع الحساب: عميل جملة أو مورد (أو كليهما).")
        return attrs


class PaymentSerializer(MultiCurrencyMixin, serializers.ModelSerializer):
    class Meta:
        model = AccountPayment
        fields = ["id", "direction", "amount", "currency", "paid_amount", "exchange_rate", "date", "note", "branch"]
        extra_kwargs = {"date": {"required": False}, "amount": {"required": False},
                        "currency": {"required": False}, "branch": {"required": False}}


class EntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = AccountEntry
        fields = ["id", "kind", "amount", "note", "date"]
        extra_kwargs = {"date": {"required": False}}


def _get(pk):
    try:
        return Account.objects.get(pk=pk)
    except Account.DoesNotExist:
        return None


def _detail(account):
    """The account with its statement (oldest first) and the invoices still open."""
    return {**_row(account), "statement": services.ledger(account), "open_orders": services.open_orders(account)}


def _row(account):
    data = AccountSerializer(account).data
    data.update(services.totals(account))
    return data


@api_view(["GET", "POST"])
def account_list(request):
    require_feature("accounts")
    if request.method == "GET":
        return Response([_row(a) for a in Account.objects.order_by("-is_active", "name")])
    serializer = AccountSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    # An opening balance (what they already owed / we already owed) becomes the first ledger line.
    opening = request.data.get("opening_balance")
    value = Decimal("0")
    if opening not in (None, "", 0, "0"):
        try:
            value = Decimal(str(opening))
        except InvalidOperation:
            raise serializers.ValidationError({"opening_balance": "رصيد غير صالح."})
        if not value.is_finite() or abs(value) >= Decimal("1e13"):
            raise serializers.ValidationError({"opening_balance": "رصيد غير صالح."})
    value = value.quantize(Decimal("0.01"))
    account = serializer.save()
    if value != 0:
        AccountEntry.objects.create(
            account=account, kind=AccountEntry.DEBIT if value > 0 else AccountEntry.CREDIT,
            amount=abs(value), note="رصيد افتتاحي",
        )
    return Response(_row(account), status=status.HTTP_201_CREATED)


@api_view(["GET", "PUT", "DELETE"])
def account_detail(request, pk):
    require_feature("accounts")
    account = _get(pk)
    if account is None:
        return Response(NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
    if request.method == "PUT":
        serializer = AccountSerializer(account, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(_row(account))
    if request.method == "DELETE":
        require_admin(request)
        if account.sales_orders.exists() or account.purchase_orders.exists() or account.payments.exists():
            raise ConflictError("للحساب فواتير أو دفعات. عطّله بدلاً من حذفه.")
        account.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    return Response(_detail(account))


@api_view(["POST"])
def account_payment(request, pk):
    require_feature("accounts")
    account = _get(pk)
    if account is None:
        return Response(NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
    serializer = PaymentSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    d = serializer.validated_data
    if d["direction"] == AccountPayment.IN and not account.is_customer:
        raise serializers.ValidationError("هذا الحساب ليس عميلاً.")
    if d["direction"] == AccountPayment.OUT and not account.is_supplier:
        raise serializers.ValidationError("هذا الحساب ليس مورداً.")
    services.record_payment(
        account, d["direction"], d["amount"], currency=d["currency"], paid_amount=d.get("paid_amount"),
        exchange_rate=d.get("exchange_rate"), when=d.get("date"), note=d.get("note", ""),
        branch_id=d["branch"].pk if d.get("branch") else default_branch().pk,  # the box of the branch that took it
    )
    return Response(_detail(account), status=status.HTTP_201_CREATED)


@api_view(["DELETE"])
def account_payment_delete(request, pk, payment_id):
    require_feature("accounts")
    require_admin(request)
    deleted, _ = AccountPayment.objects.filter(pk=payment_id, account_id=pk).delete()  # cascades to its order payments
    return Response(status=status.HTTP_204_NO_CONTENT if deleted else status.HTTP_404_NOT_FOUND)


@api_view(["POST"])
def account_entry(request, pk):
    require_feature("accounts")
    require_admin(request)
    account = _get(pk)
    if account is None:
        return Response(NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
    serializer = EntrySerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    serializer.save(account=account)
    return Response(_detail(account), status=status.HTTP_201_CREATED)


@api_view(["DELETE"])
def account_entry_delete(request, pk, entry_id):
    require_feature("accounts")
    require_admin(request)
    deleted, _ = AccountEntry.objects.filter(pk=entry_id, account_id=pk).delete()
    return Response(status=status.HTTP_204_NO_CONTENT if deleted else status.HTTP_404_NOT_FOUND)
