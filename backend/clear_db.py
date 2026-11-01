"""
Script to clear all data from SQLite database except for users.
This preserves the user accounts and their login information.
"""
import os
import sys
import django

# Setup Django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "tradeops.settings")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
django.setup()

from django.apps import apps

def clear_database_except_users():
    """Delete all data except for the User model."""
    
    # Get all models from all apps
    all_models = apps.get_models()
    
    # Models to keep
    protected_models = {'User', 'Group', 'Permission', 'ContentType'}
    
    deleted_count = 0
    
    for model in all_models:
        model_name = model.__name__
        
        # Skip protected models
        if model_name in protected_models:
            print(f"Skipping {model_name} (protected)")
            continue
        
        try:
            count = model.objects.all().count()
            if count > 0:
                model.objects.all().delete()
                deleted_count += count
                print(f"Deleted {count} {model_name} records")
            else:
                print(f"No records to delete in {model_name}")
        except Exception as e:
            print(f"Error deleting {model_name}: {e}")
    
    print(f"\nTotal records deleted: {deleted_count}")
    print("Database cleanup complete! User data preserved.")

if __name__ == "__main__":
    confirm = input("This will delete all data except users. Continue? (yes/no): ")
    if confirm.lower() == 'yes':
        clear_database_except_users()
    else:
        print("Operation cancelled.")
