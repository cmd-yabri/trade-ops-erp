from decimal import Decimal

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("partners", "0002_entry_time"),
    ]

    operations = [
        migrations.CreateModel(
            name="ProfitOpening",
            fields=[
                (
                    "id",
                    models.PositiveSmallIntegerField(
                        default=1,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("as_of", models.DateField()),
                ("net_profit", models.DecimalField(decimal_places=2, max_digits=16)),
                ("note", models.CharField(blank=True, max_length=300)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
        ),
        migrations.CreateModel(
            name="ProfitOpeningLine",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("share_percent", models.DecimalField(decimal_places=2, max_digits=5)),
                ("share_amount", models.DecimalField(decimal_places=2, max_digits=16)),
                (
                    "withdrawn_amount",
                    models.DecimalField(
                        decimal_places=2,
                        default=Decimal("0"),
                        max_digits=16,
                    ),
                ),
                (
                    "opening",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="lines",
                        to="partners.profitopening",
                    ),
                ),
                (
                    "partner",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="opening_lines",
                        to="partners.partner",
                    ),
                ),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(
                        fields=("opening", "partner"),
                        name="unique_partner_profit_opening",
                    ),
                ],
            },
        ),
    ]
