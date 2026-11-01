from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("partners", "0003_profitopening"),
    ]

    operations = [
        migrations.AddField(
            model_name="partner",
            name="opening_balance",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=16),
        ),
    ]
