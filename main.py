import pandas as pd
import geopandas as gpd
from shapely import wkb, wkt
import argparse
import sys
import os

def convert_csv_to_geojson(input_csv, output_geojson, geom_col='geometry', crs='EPSG:4326'):
    """
    Converts a CSV with a geometry column (WKB Hex or WKT) to GeoJSON.
    """
    # If output is a directory, generate filename from input
    if os.path.isdir(output_geojson):
        input_basename = os.path.basename(input_csv)
        output_filename = os.path.splitext(input_basename)[0] + '.geojson'
        output_geojson = os.path.join(output_geojson, output_filename)
    
    try:
        print(f"reading {input_csv}...")
        df = pd.read_csv(input_csv)
    except FileNotFoundError:
        print(f"Error: The file '{input_csv}' was not found.")
        return

    # Check if geometry column exists
    if geom_col not in df.columns:
        print(f"Error: Column '{geom_col}' not found in CSV.")
        print(f"Available columns: {list(df.columns)}")
        return

    def parse_geometry(geom_str):
        """
        Attempts to parse geometry from string.
        pgAdmin usually exports as Hex-encoded WKB (e.g., "01010000...")
        or sometimes WKT (e.g., "POINT(30 10)").
        """
        if pd.isna(geom_str) or geom_str == '':
            return None
        
        try:
            # Try parsing as WKB Hex string (Standard pgAdmin export)
            return wkb.loads(bytes.fromhex(geom_str))
        except Exception:
            try:
                # Fallback: Try parsing as WKT (Well-Known Text)
                return wkt.loads(geom_str)
            except Exception:
                return None

    print("Parsing geometry column...")
    # Apply the parsing function to the geometry column
    df['parsed_geometry'] = df[geom_col].apply(parse_geometry)

    # Filter out rows where geometry failed to parse
    valid_rows = df['parsed_geometry'].notna()
    skipped_count = len(df) - valid_rows.sum()
    
    if skipped_count > 0:
        print(f"Warning: Could not parse geometry for {skipped_count} rows. They will be skipped.")

    # Create GeoDataFrame
    gdf = gpd.GeoDataFrame(df[valid_rows], geometry='parsed_geometry')

    # Set the Coordinate Reference System (CRS)
    # Assuming EPSG:4326 (Lat/Lon) as it is standard for GeoJSON.
    # If your DB data is in meters (e.g., 3857), change the input CRS below 
    # and uncomment the to_crs line.
    
    if gdf.crs is None:
        gdf.set_crs(crs, inplace=True)
    
    # GeoJSON specification recommends EPSG:4326. 
    # If your data is different, convert it here:
    if crs != 'EPSG:4326':
         print("Reprojecting to EPSG:4326 for valid GeoJSON output...")
         gdf = gdf.to_crs("EPSG:4326")

    # Drop the original string geometry column to keep the file clean
    if geom_col in gdf.columns:
        gdf = gdf.drop(columns=[geom_col])

    print(f"Writing to {output_geojson}...")
    gdf.to_file(output_geojson, driver='GeoJSON')
    print("Conversion complete!")

if __name__ == "__main__":
    # Setup command line arguments
    parser = argparse.ArgumentParser(description='Convert pgAdmin CSV to GeoJSON')
    parser.add_argument('input_file', help='Path to input CSV file')
    parser.add_argument('output_file', help='Path to output GeoJSON file')
    parser.add_argument('--column', default='geometry', help='Name of the geometry column (default: geom)')
    
    args = parser.parse_args()

    convert_csv_to_geojson(args.input_file, args.output_file, geom_col=args.column)